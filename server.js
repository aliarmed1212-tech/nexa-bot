const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const multer = require('multer');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const dataDir = path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, 'nexa.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  bio TEXT DEFAULT '',
  status TEXT DEFAULT 'Available',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('direct','group')),
  title TEXT,
  avatar TEXT,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT UNIQUE,
  conversation_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  body TEXT DEFAULT '',
  attachment_url TEXT,
  attachment_name TEXT,
  reply_to INTEGER,
  edited INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(reply_to) REFERENCES messages(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY(message_id, user_id),
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reads (
  conversation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_read_message_id INTEGER DEFAULT 0,
  PRIMARY KEY(conversation_id, user_id),
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(blocker_id, blocked_id),
  FOREIGN KEY(blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(blocked_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_time ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_body ON messages(body);
`);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadDir),
    filename: (_, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${safe}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 }
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

function sign(user) {
  return jwt.sign({ id: user.id, username: user.username, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
function publicUser(id) {
  return db.prepare('SELECT id,name,username,avatar,bio,status,created_at FROM users WHERE id=?').get(id);
}
function isMember(conversationId, userId) {
  return !!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(conversationId, userId);
}
function conversationForUser(conversationId, userId) {
  return db.prepare(`
    SELECT c.*, cm.role FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id=c.id
    WHERE c.id=? AND cm.user_id=?
  `).get(conversationId, userId);
}
function conversationSummary(row, userId) {
  const last = db.prepare(`SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC, id DESC LIMIT 1`).get(row.id);
  let title = row.title;
  let avatar = row.avatar;
  if (row.type === 'direct') {
    const other = db.prepare(`
      SELECT u.id,u.name,u.username,u.avatar,u.status FROM users u
      JOIN conversation_members m ON m.user_id=u.id
      WHERE m.conversation_id=? AND u.id != ? LIMIT 1
    `).get(row.id, userId);
    if (other) { title = other.name; avatar = other.avatar; row.other_user = other; }
  }
  const read = db.prepare('SELECT last_read_message_id FROM reads WHERE conversation_id=? AND user_id=?').get(row.id, userId);
  const unread = last && (!read || last.id > read.last_read_message_id) && last.sender_id !== userId
    ? db.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id=? AND id>? AND sender_id!=?').get(row.id, read ? read.last_read_message_id : 0, userId).c
    : 0;
  return {
    id: row.id, type: row.type, title: title || 'Group', avatar: avatar || null,
    lastMessage: last ? (last.deleted ? 'Message deleted' : (last.body || last.attachment_name || 'Attachment')) : '',
    lastMessageTime: last ? last.created_at : row.created_at,
    unread,
    otherUser: row.other_user || null,
    role: row.role
  };
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, username, email, password } = req.body;
    if (!name || !username || !email || !password) return res.status(400).json({ error: 'Name, username, email and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must contain at least 8 characters' });
    const cleanUsername = username.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(cleanUsername)) return res.status(400).json({ error: 'Username must be 3-24 characters using letters, numbers or underscore' });
    const hash = await bcrypt.hash(password, 12);
    const now = Date.now();
    const result = db.prepare('INSERT INTO users(name,username,email,password_hash,created_at) VALUES(?,?,?,?,?)').run(name.trim(), cleanUsername, email.trim().toLowerCase(), hash, now);
    const user = publicUser(result.lastInsertRowid);
    res.json({ token: sign(user), user });
  } catch (e) {
    res.status(400).json({ error: e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'Username or email is already in use' : 'Could not create account' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const row = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?) OR lower(username)=lower(?)').get(email || '', email || '');
  if (!row || !(await bcrypt.compare(password || '', row.password_hash))) return res.status(401).json({ error: 'Incorrect email/username or password' });
  res.json({ token: sign(row), user: publicUser(row.id) });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user.id) }));

app.patch('/api/me', auth, (req, res) => {
  const allowed = ['name','bio','status','avatar'];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.json({ user: publicUser(req.user.id) });
  const sets = updates.map(([k]) => `${k}=?`).join(', ');
  const vals = updates.map(([,v]) => String(v).slice(0, 500));
  db.prepare(`UPDATE users SET ${sets} WHERE id=?`).run(...vals, req.user.id);
  const user = publicUser(req.user.id);
  io.emit('profile:updated', user);
  res.json({ user });
});

app.get('/api/users', auth, (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const rows = db.prepare(`SELECT id,name,username,avatar,bio,status,created_at FROM users WHERE id!=? AND (name LIKE ? OR username LIKE ?) ORDER BY name LIMIT 30`).all(req.user.id, q, q);
  res.json({ users: rows });
});

app.post('/api/conversations/direct', auth, (req, res) => {
  const otherId = Number(req.body.userId);
  if (!otherId || otherId === req.user.id || !publicUser(otherId)) return res.status(400).json({ error: 'Invalid user' });
  const existing = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=?
    JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=?
    WHERE c.type='direct' LIMIT 1
  `).get(req.user.id, otherId);
  if (existing) return res.json({ conversation: conversationSummary(db.prepare('SELECT c.*, cm.role FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.id=? AND cm.user_id=?').get(existing.id, req.user.id), req.user.id) });
  const now = Date.now();
  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO conversations(type,created_by,created_at) VALUES(\'direct\',?,?)').run(req.user.id, now);
    db.prepare('INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES(?,?,\'member\',?)').run(r.lastInsertRowid, req.user.id, now);
    db.prepare('INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES(?,?,\'member\',?)').run(r.lastInsertRowid, otherId, now);
    return r.lastInsertRowid;
  });
  const id = tx();
  const c = conversationSummary(db.prepare('SELECT c.*, cm.role FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.id=? AND cm.user_id=?').get(id, req.user.id), req.user.id);
  io.to(`user:${otherId}`).emit('conversation:new', c);
  res.json({ conversation: c });
});

app.post('/api/conversations/group', auth, (req, res) => {
  const { title, memberIds = [] } = req.body;
  const members = [...new Set([req.user.id, ...memberIds.map(Number)])].filter(Number.isInteger);
  if (!title || title.trim().length < 2) return res.status(400).json({ error: 'Group name is required' });
  if (members.length < 2) return res.status(400).json({ error: 'Select at least one other member' });
  const now = Date.now();
  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO conversations(type,title,created_by,created_at) VALUES(\'group\',?,?,?)').run(title.trim().slice(0, 80), req.user.id, now);
    for (const uid of members) db.prepare('INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES(?,?,?,?)').run(r.lastInsertRowid, uid, uid === req.user.id ? 'owner' : 'member', now);
    return r.lastInsertRowid;
  });
  const id = tx();
  const base = db.prepare('SELECT c.*, cm.role FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.id=? AND cm.user_id=?').get(id, req.user.id);
  for (const uid of members.filter(id2 => id2 !== req.user.id)) io.to(`user:${uid}`).emit('conversation:new', conversationSummary({ ...base, id }, uid));
  res.json({ conversation: conversationSummary(base, req.user.id) });
});

app.get('/api/conversations', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, cm.role FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id=c.id
    WHERE cm.user_id=?
    ORDER BY (SELECT COALESCE(MAX(m.created_at), c.created_at) FROM messages m WHERE m.conversation_id=c.id) DESC
  `).all(req.user.id);
  res.json({ conversations: rows.map(r => conversationSummary(r, req.user.id)) });
});

app.get('/api/conversations/:id/messages', auth, (req, res) => {
  const cid = Number(req.params.id);
  if (!isMember(cid, req.user.id)) return res.status(403).json({ error: 'Access denied' });
  const before = Number(req.query.before || Date.now() + 1);
  const limit = Math.min(Number(req.query.limit || 60), 100);
  const messages = db.prepare(`
    SELECT m.*, u.name AS sender_name,u.username AS sender_username,u.avatar AS sender_avatar,
      r.id AS reply_id, r.body AS reply_body, ru.name AS reply_sender_name
    FROM messages m
    JOIN users u ON u.id=m.sender_id
    LEFT JOIN messages r ON r.id=m.reply_to
    LEFT JOIN users ru ON ru.id=r.sender_id
    WHERE m.conversation_id=? AND m.created_at<?
    ORDER BY m.created_at DESC, m.id DESC LIMIT ?
  `).all(cid, before, limit).reverse();
  const ids = messages.map(m => m.id);
  let reactionMap = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const rs = db.prepare(`SELECT message_id,user_id,emoji FROM reactions WHERE message_id IN (${placeholders})`).all(...ids);
    for (const r of rs) { (reactionMap[r.message_id] ||= []).push(r); }
  }
  const out = messages.map(m => ({ ...m, reactions: reactionMap[m.id] || [] }));
  const lastId = out.length ? out[out.length - 1].id : 0;
  db.prepare(`INSERT INTO reads(conversation_id,user_id,last_read_message_id) VALUES(?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_message_id=excluded.last_read_message_id`).run(cid, req.user.id, lastId);
  res.json({ messages: out });
});

app.post('/api/conversations/:id/read', auth, (req,res) => {
  const cid = Number(req.params.id); if (!isMember(cid,req.user.id)) return res.status(403).json({error:'Access denied'});
  const lastId = Number(req.body.lastMessageId || 0);
  db.prepare(`INSERT INTO reads(conversation_id,user_id,last_read_message_id) VALUES(?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_message_id=excluded.last_read_message_id`).run(cid,req.user.id,lastId);
  const members = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=?').all(cid);
  for (const m of members) io.to(`user:${m.user_id}`).emit('conversation:read',{conversationId:cid,userId:req.user.id,lastMessageId:lastId});
  res.json({ok:true});
});

app.post('/api/conversations/:id/messages', auth, (req, res) => {
  const cid = Number(req.params.id);
  if (!isMember(cid, req.user.id)) return res.status(403).json({ error: 'Access denied' });
  const { body = '', attachmentUrl = null, attachmentName = null, replyTo = null, clientId = null } = req.body;
  if (!String(body).trim() && !attachmentUrl) return res.status(400).json({ error: 'Message cannot be empty' });
  if (clientId) {
    const existing = db.prepare('SELECT * FROM messages WHERE client_id=?').get(clientId);
    if (existing) return res.json({ message: hydrateMessage(existing) });
  }
  const now = Date.now();
  const info = db.prepare(`INSERT INTO messages(client_id,conversation_id,sender_id,body,attachment_url,attachment_name,reply_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(clientId, cid, req.user.id, String(body).slice(0, 10000), attachmentUrl, attachmentName, replyTo, now, now);
  const message = hydrateMessage(db.prepare('SELECT * FROM messages WHERE id=?').get(info.lastInsertRowid));
  broadcastToConversation(cid, 'message:new', message);
  res.json({ message });
});

function hydrateMessage(m) {
  const u = publicUser(m.sender_id);
  const replies = m.reply_to ? db.prepare('SELECT m.id,m.body,u.name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?').get(m.reply_to) : null;
  const reactions = db.prepare('SELECT * FROM reactions WHERE message_id=?').all(m.id);
  return { ...m, sender_name:u?.name, sender_username:u?.username, sender_avatar:u?.avatar, reply: replies, reactions };
}
function broadcastToConversation(cid, event, payload) {
  const members = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=?').all(cid);
  for (const m of members) io.to(`user:${m.user_id}`).emit(event, payload);
}

app.patch('/api/messages/:id', auth, (req,res) => {
  const id=Number(req.params.id);
  const m=db.prepare('SELECT * FROM messages WHERE id=?').get(id);
  if(!m || m.sender_id!==req.user.id) return res.status(403).json({error:'You can only edit your own messages'});
  if(m.deleted) return res.status(400).json({error:'Message is deleted'});
  db.prepare('UPDATE messages SET body=?, edited=1, updated_at=? WHERE id=?').run(String(req.body.body||'').slice(0,10000),Date.now(),id);
  const updated=hydrateMessage(db.prepare('SELECT * FROM messages WHERE id=?').get(id));
  broadcastToConversation(m.conversation_id,'message:updated',updated);
  res.json({message:updated});
});

app.delete('/api/messages/:id', auth, (req,res) => {
  const id=Number(req.params.id);
  const m=db.prepare('SELECT * FROM messages WHERE id=?').get(id);
  if(!m || (m.sender_id!==req.user.id && !isOwnerOrAdmin(m.conversation_id,req.user.id))) return res.status(403).json({error:'You cannot delete this message'});
  db.prepare('UPDATE messages SET deleted=1, body=\'\', attachment_url=NULL, attachment_name=NULL, updated_at=? WHERE id=?').run(Date.now(),id);
  const updated=hydrateMessage(db.prepare('SELECT * FROM messages WHERE id=?').get(id));
  broadcastToConversation(m.conversation_id,'message:updated',updated);
  res.json({message:updated});
});

function isOwnerOrAdmin(cid,uid){ const r=db.prepare(`SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?`).get(cid,uid); return r && ['owner','admin'].includes(r.role); }

app.post('/api/messages/:id/reaction', auth, (req,res) => {
  const id=Number(req.params.id); const m=db.prepare('SELECT * FROM messages WHERE id=?').get(id);
  if(!m || !isMember(m.conversation_id,req.user.id)) return res.status(403).json({error:'Access denied'});
  const emoji=String(req.body.emoji||'').slice(0,8); if(!emoji) return res.status(400).json({error:'Emoji required'});
  const existing=db.prepare('SELECT * FROM reactions WHERE message_id=? AND user_id=?').get(id,req.user.id);
  if(existing?.emoji===emoji) db.prepare('DELETE FROM reactions WHERE message_id=? AND user_id=?').run(id,req.user.id); else db.prepare('INSERT INTO reactions(message_id,user_id,emoji) VALUES(?,?,?) ON CONFLICT(message_id,user_id) DO UPDATE SET emoji=excluded.emoji').run(id,req.user.id,emoji);
  const reactions=db.prepare('SELECT * FROM reactions WHERE message_id=?').all(id);
  broadcastToConversation(m.conversation_id,'message:reaction',{messageId:id,reactions});
  res.json({reactions});
});

app.post('/api/upload', auth, upload.single('file'), (req,res) => {
  if(!req.file) return res.status(400).json({error:'No file uploaded'});
  res.json({ url:`/uploads/${encodeURIComponent(req.file.filename)}`, name:req.file.originalname, size:req.file.size, mime:req.file.mimetype });
});

app.get('/api/search', auth, (req,res) => {
  const q=String(req.query.q||'').trim(); if(q.length<2) return res.json({messages:[]});
  const term=`%${q}%`;
  const rows=db.prepare(`
    SELECT m.id,m.conversation_id,m.body,m.created_at,u.name sender_name,c.title conversation_title,c.type
    FROM messages m JOIN users u ON u.id=m.sender_id JOIN conversations c ON c.id=m.conversation_id
    WHERE m.deleted=0 AND m.body LIKE ? AND EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=m.conversation_id AND cm.user_id=?)
    ORDER BY m.created_at DESC LIMIT 50
  `).all(term,req.user.id);
  res.json({messages:rows});
});

app.post('/api/users/:id/block', auth, (req,res)=>{
  const blocked=Number(req.params.id); if(!publicUser(blocked)||blocked===req.user.id) return res.status(400).json({error:'Invalid user'});
  db.prepare('INSERT OR IGNORE INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)').run(req.user.id,blocked,Date.now());
  res.json({ok:true});
});
app.delete('/api/users/:id/block', auth, (req,res)=>{
  db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(req.user.id,Number(req.params.id));
  res.json({ok:true});
});

io.use((socket,next)=>{
  try { const token=socket.handshake.auth?.token; socket.user=jwt.verify(token,JWT_SECRET); next(); }
  catch { next(new Error('Unauthorized')); }
});
const online=new Map();
io.on('connection',socket=>{
  const uid=socket.user.id;
  socket.join(`user:${uid}`);
  online.set(uid,(online.get(uid)||0)+1);
  broadcastPresence(uid,'online');

  socket.on('conversation:join',cid=>{ if(isMember(Number(cid),uid)) socket.join(`conversation:${Number(cid)}`); });
  socket.on('typing:start',cid=>{ if(isMember(Number(cid),uid)) broadcastToConversation(Number(cid),'typing:update',{conversationId:Number(cid),userId:uid,typing:true}); });
  socket.on('typing:stop',cid=>{ if(isMember(Number(cid),uid)) broadcastToConversation(Number(cid),'typing:update',{conversationId:Number(cid),userId:uid,typing:false}); });
  socket.on('presence:set',status=>{ const safe=['online','away','busy','invisible'].includes(status)?status:'online'; broadcastPresence(uid,safe); });
  socket.on('disconnect',()=>{ online.set(uid,Math.max(0,(online.get(uid)||1)-1)); if(!online.get(uid)){online.delete(uid);broadcastPresence(uid,'offline');} });
});
function broadcastPresence(uid,status){ io.emit('presence:update',{userId:uid,status}); }

app.get(/.*/, (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

server.listen(PORT,()=>console.log(`NEXA Chat running at http://localhost:${PORT}`));
