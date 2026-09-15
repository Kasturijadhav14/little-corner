import { Router } from 'express';
import bcrypt from 'bcrypt';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { pool } from '../db.js';

const router = Router();
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(uploadRoot, { recursive: true });

const allowed = new Map([
  ['image/jpeg','photo'],['image/png','photo'],['image/webp','photo'],['image/gif','photo'],
  ['video/mp4','video'],['video/webm','video'],['video/quicktime','video'],
  ['audio/webm','audio'],['audio/ogg','audio'],['audio/mpeg','audio'],['audio/wav','audio']
]);
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadRoot),
  filename: (_, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 30 },
  fileFilter: (_, file, cb) => allowed.has(file.mimetype) ? cb(null, true) : cb(new Error('Unsupported file type.'))
});

const publicMemory = (m) => ({
  id:m.id, title:m.title, contentHtml:m.content_html, mood:m.mood, memoryAt:m.memory_at,
  location:m.location, backgroundStyle:m.background_style,
  authorId:m.author_id, authorName:m.author_name,
  createdAt:m.created_at, updatedAt:m.updated_at,
  seenByOther: Boolean(m.seen_by_other), seenByOtherAt:m.seen_by_other_at || null,
  seenByMe: Boolean(m.seen_by_me), seenByMeAt:m.seen_by_me_at || null
});


router.get('/', async (req,res,next) => {
  try {
    const { q='', mood='', from='', to='' } = req.query;
    const values = [];
    const where = [];
    if (q) {
      values.push(`%${q}%`);
      where.push(`(m.title ILIKE $${values.length} OR m.content_html ILIKE $${values.length} OR COALESCE(m.location,'') ILIKE $${values.length})`);
    }
    if (mood) { values.push(mood); where.push(`m.mood=$${values.length}`); }
    if (from) { values.push(from); where.push(`m.memory_at >= $${values.length}::timestamptz`); }
    if (to) { values.push(to); where.push(`m.memory_at <= $${values.length}::timestamptz`); }
    values.push(req.user.id);
    const viewerParam = `$${values.length}`;
    const sql = `SELECT m.*, u.display_name author_name,
      EXISTS(SELECT 1 FROM memory_reads mr WHERE mr.memory_id=m.id AND mr.user_id<>m.author_id) AS seen_by_other,
      (SELECT mr.first_seen_at FROM memory_reads mr WHERE mr.memory_id=m.id AND mr.user_id<>m.author_id ORDER BY mr.first_seen_at LIMIT 1) AS seen_by_other_at,
      EXISTS(SELECT 1 FROM memory_reads mr WHERE mr.memory_id=m.id AND mr.user_id=${viewerParam}) AS seen_by_me,
      (SELECT mr.first_seen_at FROM memory_reads mr WHERE mr.memory_id=m.id AND mr.user_id=${viewerParam} LIMIT 1) AS seen_by_me_at
      FROM memories m JOIN users u ON u.id=m.author_id
      ${where.length ? 'WHERE '+where.join(' AND ') : ''} ORDER BY m.memory_at DESC`;
    const { rows } = await pool.query(sql, values);
    res.json(rows.map(publicMemory));
  } catch(e){ next(e); }
});

router.post('/', upload.array('media', 30), async (req,res,next) => {
  const client = await pool.connect();
  try {
    const { title, contentHtml='', mood='❤️', memoryAt, location='', backgroundStyle='wine' } = req.body;
    if (!title?.trim()) return res.status(400).json({ message:'Title is required.' });
    await client.query('BEGIN');
    const hash = await bcrypt.hash(crypto.randomUUID(), 12);
    const result = await client.query(
      `INSERT INTO memories(author_id,title,content_html,mood,memory_at,location,background_style,note_password_hash)
       VALUES($1,$2,$3,$4,COALESCE($5::timestamptz,NOW()),NULLIF($6,''),$7,$8)
       RETURNING *`,
      [req.user.id,title.trim(),contentHtml,mood,memoryAt || null,location,backgroundStyle,hash]
    );
    const memory = result.rows[0];
    for (const file of (req.files || [])) {
      const type = allowed.get(file.mimetype);
      await client.query(
        `INSERT INTO memory_media(memory_id,media_type,original_name,stored_name,mime_type,size_bytes)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [memory.id,type,file.originalname,file.filename,file.mimetype,file.size]
      );
    }
    await client.query('COMMIT');
    const full = await getMemory(memory.id);
    res.status(201).json(full);
  } catch(e){ await client.query('ROLLBACK'); for (const f of (req.files||[])) fs.rm(f.path,{force:true},()=>{}); next(e); }
  finally { client.release(); }
});

router.post('/:id/unlock', async (req,res,next) => {
  try {
    const exists = await pool.query('SELECT id FROM memories WHERE id=$1',[req.params.id]);
    if (!exists.rows[0]) return res.status(404).json({message:'Memory not found.'});
    await pool.query(`INSERT INTO memory_reads(memory_id,user_id) VALUES($1,$2)
      ON CONFLICT(memory_id,user_id) DO UPDATE SET last_seen_at=NOW()`,[req.params.id,req.user.id]);
    const full = await getMemory(req.params.id, req.user.id);
    res.json({ memory:full });
  } catch(e){ next(e); }
});

router.put('/:id', upload.array('media', 30), async (req,res,next) => {
  const client = await pool.connect();
  try {
    const { title, contentHtml='', mood='❤️', memoryAt, location='', backgroundStyle='wine', deleteMediaIds='[]' } = req.body;
    const check = { ok:true };
    if (!check.ok) return res.status(check.status).json({message:check.message});
    await client.query('BEGIN');
    await client.query(
      `UPDATE memories SET title=$1,content_html=$2,mood=$3,memory_at=$4,location=NULLIF($5,''),background_style=$6,updated_at=NOW()
       WHERE id=$7`,
      [title.trim(),contentHtml,mood,memoryAt,location,backgroundStyle,req.params.id]
    );
    let ids=[]; try { ids=JSON.parse(deleteMediaIds || '[]'); } catch {}
    if (Array.isArray(ids) && ids.length) {
      const media = await client.query(`SELECT stored_name FROM memory_media WHERE memory_id=$1 AND id=ANY($2::uuid[])`,[req.params.id,ids]);
      await client.query(`DELETE FROM memory_media WHERE memory_id=$1 AND id=ANY($2::uuid[])`,[req.params.id,ids]);
      for(const row of media.rows) fs.rm(path.join(uploadRoot,row.stored_name),{force:true},()=>{});
    }
    for(const file of (req.files||[])){
      const type=allowed.get(file.mimetype);
      await client.query(`INSERT INTO memory_media(memory_id,media_type,original_name,stored_name,mime_type,size_bytes)
        VALUES($1,$2,$3,$4,$5,$6)`,[req.params.id,type,file.originalname,file.filename,file.mimetype,file.size]);
    }
    await client.query('COMMIT');
    res.json(await getMemory(req.params.id));
  } catch(e){ await client.query('ROLLBACK'); next(e); } finally { client.release(); }
});

router.post('/:id/reactions', async(req,res,next)=>{
  try{
    const reaction=String(req.body?.reaction||'').trim();
    const valid=['❤️','🖤','😘','🥀','🌙'];
    if(!valid.includes(reaction)) return res.status(400).json({message:'Invalid reaction.'});
    await pool.query(`INSERT INTO reactions(memory_id,user_id,reaction) VALUES($1,$2,$3)
      ON CONFLICT(memory_id,user_id,reaction) DO NOTHING`,[req.params.id,req.user.id,reaction]);
    res.json(await reactions(req.params.id));
  }catch(e){next(e);}
});

router.delete('/:id/reactions/:reaction', async(req,res,next)=>{
  try{
    await pool.query(`DELETE FROM reactions WHERE memory_id=$1 AND user_id=$2 AND reaction=$3`,
      [req.params.id,req.user.id,req.params.reaction]);
    res.json(await reactions(req.params.id));
  }catch(e){next(e);}
});

router.post('/:id/comments', async(req,res,next)=>{
  try{
    const text=String(req.body?.text||'').trim();
    const emoji=String(req.body?.emoji||'').trim().slice(0,10);
    if(!text) return res.status(400).json({message:'Comment cannot be empty.'});
    const {rows}=await pool.query(`INSERT INTO comments(memory_id,user_id,text,emoji) VALUES($1,$2,$3,$4)
      RETURNING id,text,emoji,created_at`,[req.params.id,req.user.id,text,emoji||null]);
    res.status(201).json({...rows[0],displayName:req.user.displayName});
  }catch(e){next(e);}
});

router.get('/:id/gallery', async(req,res,next)=>{
  try{
    const {rows}=await pool.query(`SELECT mm.*, m.title FROM memory_media mm JOIN memories m ON m.id=mm.memory_id
      WHERE mm.memory_id=$1 ORDER BY mm.created_at`,[req.params.id]);
    res.json(rows.map(media=>({...media,url:`/uploads/${media.stored_name}`})));
  }catch(e){next(e);}
});

router.delete('/:id', async(req,res,next)=>{
  try{
    const check={ok:true};
    if(!check.ok) return res.status(check.status).json({message:check.message});
    const media=await pool.query('SELECT stored_name FROM memory_media WHERE memory_id=$1',[req.params.id]);
    await pool.query('DELETE FROM memories WHERE id=$1',[req.params.id]);
    for(const m of media.rows) fs.rm(path.join(uploadRoot,m.stored_name),{force:true},()=>{});
    res.json({ok:true});
  }catch(e){next(e);}
});

async function reactions(id){
  const {rows}=await pool.query(`SELECT r.id,r.reaction,r.created_at,u.display_name FROM reactions r JOIN users u ON u.id=r.user_id WHERE r.memory_id=$1 ORDER BY r.created_at`,[id]);
  return rows;
}
async function getMemory(id, viewerId=null){
  const m=await pool.query(`SELECT m.*,u.display_name author_name,
    EXISTS(SELECT 1 FROM memory_reads mr WHERE mr.memory_id=m.id AND mr.user_id<>m.author_id) AS seen_by_other,
    (SELECT mr.first_seen_at FROM memory_reads mr WHERE mr.memory_id=m.id AND mr.user_id<>m.author_id ORDER BY mr.first_seen_at LIMIT 1) AS seen_by_other_at,
    ${viewerId ? 'EXISTS(SELECT 1 FROM memory_reads mr WHERE mr.memory_id=m.id AND mr.user_id=$2) AS seen_by_me, (SELECT mr.first_seen_at FROM memory_reads mr WHERE mr.memory_id=m.id AND mr.user_id=$2 LIMIT 1) AS seen_by_me_at' : 'FALSE AS seen_by_me, NULL AS seen_by_me_at'}
    FROM memories m JOIN users u ON u.id=m.author_id WHERE m.id=$1`, viewerId ? [id,viewerId] : [id]);
  if(!m.rows[0]) return null;
  const media=await pool.query(`SELECT id,media_type,original_name,stored_name,mime_type,size_bytes,created_at FROM memory_media WHERE memory_id=$1 ORDER BY created_at`,[id]);
  const comments=await pool.query(`SELECT c.id,c.text,c.emoji,c.created_at,u.display_name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.memory_id=$1 ORDER BY c.created_at`,[id]);
  return {...publicMemory(m.rows[0]),media:media.rows.map(x=>({...x,url:`/uploads/${x.stored_name}`})),reactions:await reactions(id),comments:comments.rows};
}
export default router;





