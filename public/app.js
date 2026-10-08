(() => {
  const state = {
    token: localStorage.getItem('nexa_token'), user: null, conversations: [], activeId: null,
    messages: [], replyTo: null, editingId: null, socket: null, typingTimer: null, typingUserIds: new Set(),
    filter: 'all', query: '', theme: localStorage.getItem('nexa_theme') || 'dark'
  };

  const app = document.getElementById('app');
  const toastRoot = document.getElementById('toast-root');
  document.documentElement.dataset.theme = state.theme;

  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const initials = n => String(n || '?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
  const fmt = ts => { const d=new Date(ts); const same=new Date().toDateString()===d.toDateString(); return same ? d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : d.toLocaleDateString([], {month:'short',day:'numeric'}); };
  const api = async (url, opts={}) => {
    const headers = {'Content-Type':'application/json', ...(opts.headers||{})};
    if(state.token) headers.Authorization=`Bearer ${state.token}`;
    const res=await fetch(url,{...opts,headers});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Request failed');
    return data;
  };
  const toast = (msg,error=false) => { const el=document.createElement('div'); el.className='toast'+(error?' error':''); el.textContent=msg; toastRoot.appendChild(el); setTimeout(()=>el.remove(),3000); };
  const avatar = (u, cls='avatar') => u?.avatar ? `<img class="${cls}" src="${esc(u.avatar)}" alt="">` : `<div class="${cls}">${esc(initials(u?.name))}</div>`;

  function renderAuth(mode='login', error=''){
    app.innerHTML=`<div class="auth-shell"><div class="auth-card glass">
      <div class="brand"><div class="logo">N</div><span>NEXA</span></div>
      <h1>${mode==='login'?'Welcome back.':'Create your account.'}</h1>
      <p>${mode==='login'?'Fast, focused communication with realtime messaging.':'Join NEXA and start your first conversation.'}</p>
      ${error?`<div style="margin-top:16px;color:#fb9aaa;font-size:12px">${esc(error)}</div>`:''}
      <form id="auth-form" class="form">
        ${mode==='register'?`<div class="field"><label>Display name</label><input name="name" required autocomplete="name" placeholder="Ali Khan"></div><div class="field"><label>Username</label><input name="username" required autocomplete="username" placeholder="ali_khan"></div>`:''}
        <div class="field"><label>Email or username</label><input name="email" required autocomplete="username" placeholder="you@example.com"></div>
        <div class="field"><label>Password</label><input name="password" type="password" minlength="8" required autocomplete="current-password" placeholder="At least 8 characters"></div>
        <button class="primary" type="submit">${mode==='login'?'Sign in':'Create account'}</button>
      </form>
      <div class="auth-switch">${mode==='login'?`New here? <button id="switch-auth" class="tiny-link">Create an account</button>`:`Already have an account? <button id="switch-auth" class="tiny-link">Sign in</button>`}</div>
    </div></div>`;
    document.getElementById('switch-auth').onclick=()=>renderAuth(mode==='login'?'register':'login');
    document.getElementById('auth-form').onsubmit=async e=>{e.preventDefault(); const form=new FormData(e.target); try{ const data=await api(mode==='login'?'/api/auth/login':'/api/auth/register',{method:'POST',body:JSON.stringify(Object.fromEntries(form))}); state.token=data.token; state.user=data.user; localStorage.setItem('nexa_token',state.token); boot(); }catch(err){renderAuth(mode,err.message)} };
  }

  async function boot(){
    try{ const me=await api('/api/me'); state.user=me.user; await loadConversations(); connectSocket(); renderApp(); if(state.conversations.length) openConversation(state.conversations[0].id); }
    catch{ state.token=null; localStorage.removeItem('nexa_token'); renderAuth(); }
  }
  async function loadConversations(){ state.conversations=(await api('/api/conversations')).conversations; }
  function connectSocket(){ if(state.socket) state.socket.disconnect(); state.socket=io({auth:{token:state.token}}); 
    state.socket.on('message:new',m=>{if(m.conversation_id===state.activeId){state.messages.push(m); renderMessages(); scrollBottom(true); markRead();} upsertConversationPreview(m); renderConversationList();});
    state.socket.on('message:updated',m=>{const i=state.messages.findIndex(x=>x.id===m.id);if(i>=0){state.messages[i]=m;renderMessages();} upsertConversationPreview(m);});
    state.socket.on('message:reaction',p=>{const m=state.messages.find(x=>x.id===p.messageId);if(m){m.reactions=p.reactions;renderMessages();}});
    state.socket.on('typing:update',p=>{if(p.conversationId===state.activeId){if(p.typing)state.typingUserIds.add(p.userId);else state.typingUserIds.delete(p.userId);renderTyping();}});
    state.socket.on('conversation:new',c=>{ if(!state.conversations.some(x=>x.id===c.id)){state.conversations.unshift(c);renderConversationList();} });
    state.socket.on('profile:updated',u=>{if(state.user?.id===u.id)state.user=u;});
    state.socket.on('presence:update',p=>{state.conversations.forEach(c=>{if(c.otherUser?.id===p.userId)c.otherUser.status=p.status;});if(state.activeId)renderHeader();});
  }
  function renderApp(){
    app.innerHTML=`<div class="chat-shell">
      <aside class="sidebar glass"><div class="sidebar-top"><div class="brand"><div class="logo">N</div><span>NEXA</span></div><div class="sidebar-actions"><button class="icon-btn" id="new-chat" title="New chat">＋</button><button class="icon-btn" id="theme-btn" title="Toggle theme">◐</button></div></div>
      <div class="searchbox"><span class="search-icon">⌕</span><input id="global-search" placeholder="Search messages, people..."></div>
      <div class="filters"><button class="filter active" data-filter="all">All</button><button class="filter" data-filter="unread">Unread</button><button class="filter" data-filter="groups">Groups</button></div>
      <div id="chat-list" class="chat-list"></div>
      <div class="profile-strip"><div class="profile-left">${avatar(state.user,'avatar small')}<div class="profile-copy"><strong>${esc(state.user.name)}</strong><span>@${esc(state.user.username)}</span></div></div><button class="icon-btn" id="settings-btn" title="Settings">⚙</button></div>
      </aside>
      <main id="conversation" class="conversation glass"><div id="empty-chat" style="display:grid;place-items:center;color:var(--muted);font-size:13px">Select a conversation to begin</div></main>
      <aside id="details" class="details"></aside>
    </div>
    <div id="modal-root"></div>`;
    document.getElementById('new-chat').onclick=()=>newChatModal();
    document.getElementById('settings-btn').onclick=()=>settingsModal();
    document.getElementById('theme-btn').onclick=toggleTheme;
    document.getElementById('global-search').oninput=debounce(e=>globalSearch(e.target.value),350);
    document.querySelectorAll('.filter').forEach(b=>b.onclick=()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.filter=b.dataset.filter;renderConversationList();});
    renderConversationList();
  }
  const debounce=(fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}};

  function renderConversationList(){
    const list=document.getElementById('chat-list'); if(!list)return;
    let cs=state.conversations.filter(c=> state.filter==='all'||(state.filter==='unread'&&c.unread>0)||(state.filter==='groups'&&c.type==='group'));
    list.innerHTML=cs.length?cs.map(c=>`<button class="chat-item ${c.id===state.activeId?'active':''}" data-id="${c.id}">${avatar(c.otherUser||{name:c.title,avatar:c.avatar},'avatar')}<div class="chat-meta"><div class="chat-title"><strong>${esc(c.title)}</strong>${c.unread?`<span class="badge">${c.unread}</span>`:''}</div><div class="chat-preview">${esc(c.lastMessage||'Start chatting')}</div></div><div class="chat-time">${fmt(c.lastMessageTime)}</div></button>`).join(''):`<div style="padding:25px;color:var(--muted);font-size:12px;text-align:center">No conversations yet.</div>`;
    list.querySelectorAll('.chat-item').forEach(b=>b.onclick=()=>openConversation(Number(b.dataset.id)));
  }
  function activeConv(){return state.conversations.find(c=>c.id===state.activeId)}
  async function openConversation(id){state.activeId=id; renderConversationList(); document.getElementById('conversation').classList.add('mobile-open'); const c=activeConv();
    document.getElementById('conversation').innerHTML=`<header class="chat-header"><div class="chat-head-left"><button class="icon-btn mobile-only" id="back-btn">‹</button>${avatar(c.otherUser||{name:c.title,avatar:c.avatar},'avatar small')}<div class="chat-head-title"><strong id="chat-head-name">${esc(c.title)}</strong><span id="chat-head-status">${c.type==='group'?'Group chat':(c.otherUser?.status||'Offline')}</span></div></div><div class="head-actions"><button class="icon-btn" id="search-chat" title="Search">⌕</button><button class="icon-btn" id="info-chat" title="Details">ⓘ</button></div></header><section class="message-area" id="message-area"><div class="message-stack" id="message-stack"></div></section><div class="typing" id="typing"></div><div class="composer-wrap"><div id="reply-bar"></div><form id="composer" class="composer"><button type="button" class="icon-btn" id="attach-btn">＋</button><textarea id="message-input" rows="1" placeholder="Write a message..."></textarea><button type="button" class="icon-btn" id="emoji-btn">😊</button><button class="send" type="submit">➤</button><input type="file" id="file-input" hidden></form></div>`;
    document.getElementById('back-btn').onclick=()=>document.getElementById('conversation').classList.remove('mobile-open');
    document.getElementById('info-chat').onclick=()=>renderDetails(c);
    document.getElementById('attach-btn').onclick=()=>document.getElementById('file-input').click();
    document.getElementById('emoji-btn').onclick=()=>{document.getElementById('message-input').value+='🙂';document.getElementById('message-input').focus();};
    document.getElementById('file-input').onchange=async e=>{if(e.target.files[0])await sendAttachment(e.target.files[0]);};
    const input=document.getElementById('message-input'); input.oninput=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,130)+'px';state.socket?.emit('typing:start',id);clearTimeout(state.typingTimer);state.typingTimer=setTimeout(()=>state.socket?.emit('typing:stop',id),900)};
    input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('composer').requestSubmit();}};
    document.getElementById('composer').onsubmit=async e=>{e.preventDefault();const body=input.value.trim();if(!body)return;try{if(state.editingId){const data=await api('/api/messages/'+state.editingId,{method:'PATCH',body:JSON.stringify({body})});state.editingId=null;input.value='';renderReplyBar();}else{const clientId=crypto.randomUUID(); await api(`/api/conversations/${id}/messages`,{method:'POST',body:JSON.stringify({body,replyTo:state.replyTo?.id||null,clientId})});input.value='';state.replyTo=null;renderReplyBar();}state.socket?.emit('typing:stop',id);input.focus();}catch(err){toast(err.message,true)}};
    const result=await api(`/api/conversations/${id}/messages?limit=60`); state.messages=result.messages; renderMessages(); renderTyping(); scrollBottom(); markRead(); state.socket?.emit('conversation:join',id); renderDetails(c);
  }
  function renderHeader(){const c=activeConv();if(!c)return;const el=document.getElementById('chat-head-status');if(el)el.textContent=c.type==='group'?'Group chat':(c.otherUser?.status||'Offline');}
  function renderMessages(){const box=document.getElementById('message-stack');if(!box)return;let lastDay='';box.innerHTML=state.messages.map(m=>{const d=new Date(m.created_at).toDateString();const sep=d!==lastDay?`<div class="day-sep">${new Date(m.created_at).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'})}</div>`:'';lastDay=d;const mine=m.sender_id===state.user.id;const reply=m.reply||null;const reactions=(m.reactions||[]).reduce((acc,r)=>{acc[r.emoji]=(acc[r.emoji]||0)+1;return acc;},{});const content=m.deleted?'<em class="edited">Message deleted</em>':m.attachment_url?`${renderAttachment(m)}${m.body?`<div>${esc(m.body)}</div>`:''}`:esc(m.body);return `${sep}<div class="message-row ${mine?'mine':''}"><div class="avatar-wrap">${!mine?avatar({name:m.sender_name,avatar:m.sender_avatar},'avatar xsmall'):''}</div><div class="bubble-wrap"><div class="sender-label">${mine?'You':esc(m.sender_name||'User')}</div><div class="bubble">${reply?`<div class="reply-preview"><strong>${esc(reply.sender_name||'Reply')}</strong><br>${esc(reply.body||'Attachment')}</div>`:''}${content}</div><div class="reactions">${Object.entries(reactions).map(([e,n])=>`<button class="reaction" data-mid="${m.id}" data-emoji="${e}">${e} ${n}</button>`).join('')}</div><div class="msg-time">${fmt(m.created_at)} ${m.edited&&!m.deleted?'· edited':''}</div></div><div class="msg-actions"><button class="tiny-action" data-action="reply" data-id="${m.id}">↩</button><button class="tiny-action" data-action="react" data-id="${m.id}">☺</button>${mine?`<button class="tiny-action" data-action="edit" data-id="${m.id}">✎</button>`:''}${mine?`<button class="tiny-action" data-action="delete" data-id="${m.id}">⌫</button>`:''}</div></div>`}).join('');
    box.querySelectorAll('.reaction').forEach(b=>b.onclick=async()=>{try{await api('/api/messages/'+b.dataset.mid+'/reaction',{method:'POST',body:JSON.stringify({emoji:b.dataset.emoji})})}catch(e){toast(e.message,true)}});
    box.querySelectorAll('.tiny-action').forEach(b=>b.onclick=()=>messageAction(b.dataset.action,Number(b.dataset.id)));
    box.querySelectorAll('.msg-actions').forEach(x=>x.style.display='flex');
  }
  function renderAttachment(m){const url=esc(m.attachment_url);if(/^image\//.test(m.attachment_mime||'')||/\.(jpg|jpeg|png|gif|webp)$/i.test(m.attachment_name||''))return `<a href="${url}" target="_blank"><img class="attachment" src="${url}" alt="${esc(m.attachment_name||'image')}"></a>`;return `<a class="file-card" href="${url}" target="_blank" download><span class="file-icon">▣</span><span><strong>${esc(m.attachment_name||'File')}</strong><br><small style="color:var(--muted)">Open / download</small></span></a>`}
  function renderTyping(){const el=document.getElementById('typing');if(!el)return;el.textContent=state.typingUserIds.size?'Someone is typing…':'';}
  function scrollBottom(force=false){const el=document.getElementById('message-area');if(el&&(force||el.scrollHeight-el.scrollTop-el.clientHeight<220))requestAnimationFrame(()=>el.scrollTop=el.scrollHeight);}
  async function markRead(){const last=state.messages[state.messages.length-1];if(last)try{await api(`/api/conversations/${state.activeId}/read`,{method:'POST',body:JSON.stringify({lastMessageId:last.id})});const c=activeConv();if(c)c.unread=0;renderConversationList();}catch{}}
  function upsertConversationPreview(m){const c=state.conversations.find(x=>x.id===m.conversation_id);if(!c)return;c.lastMessage=m.deleted?'Message deleted':(m.body||m.attachment_name||'Attachment');c.lastMessageTime=m.created_at;if(m.sender_id!==state.user.id&&m.conversation_id!==state.activeId)c.unread=(c.unread||0)+1;state.conversations=[c,...state.conversations.filter(x=>x.id!==c.id)];}
  function renderReplyBar(){const el=document.getElementById('reply-bar');if(!el)return;if(state.editingId){el.innerHTML=`<div>Editing message</div><button class="tiny-link" id="cancel-reply">Cancel</button>`}else if(state.replyTo){el.innerHTML=`<div>Replying to <strong>${esc(state.replyTo.sender_name)}</strong>: ${esc(state.replyTo.body||'Attachment')}</div><button class="tiny-link" id="cancel-reply">Cancel</button>`}else el.innerHTML='';document.getElementById('cancel-reply')?.addEventListener('click',()=>{state.replyTo=null;state.editingId=null;renderReplyBar()})}
  function messageAction(action,id){const m=state.messages.find(x=>x.id===id);if(!m)return;if(action==='reply'){state.replyTo=m;state.editingId=null;renderReplyBar();document.getElementById('message-input')?.focus();}else if(action==='react'){api('/api/messages/'+id+'/reaction',{method:'POST',body:JSON.stringify({emoji:'❤️'})}).catch(e=>toast(e.message,true));}else if(action==='edit'){state.editingId=id;state.replyTo=null;renderReplyBar();const i=document.getElementById('message-input');i.value=m.body||'';i.focus();}else if(action==='delete'){if(confirm('Delete this message?'))api('/api/messages/'+id,{method:'DELETE'}).catch(e=>toast(e.message,true));}}
  async function sendAttachment(file){if(file.size>15*1024*1024)return toast('Maximum file size is 15 MB',true);const fd=new FormData();fd.append('file',file);try{const res=await fetch('/api/upload',{method:'POST',headers:{Authorization:`Bearer ${state.token}`},body:fd});const data=await res.json();if(!res.ok)throw new Error(data.error||'Upload failed');await api(`/api/conversations/${state.activeId}/messages`,{method:'POST',body:JSON.stringify({attachmentUrl:data.url,attachmentName:data.name,body:'',clientId:crypto.randomUUID()})});toast('Attachment sent');}catch(e){toast(e.message,true)}}

  async function newChatModal(){
    modal(`<div class="modal-head"><h3>New conversation</h3><button class="icon-btn" id="close-modal">×</button></div><div class="form"><div class="field"><label>Search people</label><input id="user-search" placeholder="Name or @username"></div><div id="user-results"></div><hr style="border:0;border-top:1px solid var(--line);width:100%"><div class="field"><label>Or create a group</label><input id="group-name" placeholder="Group name"></div><div id="group-members"></div><button class="primary" id="create-group">Create group</button></div>`);
    document.getElementById('close-modal').onclick=closeModal;let selected=new Set();
    const search=debounce(async()=>{const q=document.getElementById('user-search').value.trim();if(q.length<2)return;try{const {users}=await api('/api/users?q='+encodeURIComponent(q));document.getElementById('user-results').innerHTML=users.map(u=>`<div class="user-result">${avatar(u,'avatar small')}<div><strong>${esc(u.name)}</strong><div style="color:var(--muted);font-size:11px">@${esc(u.username)}</div></div><button class="secondary" data-user="${u.id}" data-action="direct">Chat</button><label style="margin-left:auto"><input type="checkbox" data-user="${u.id}"></label></div>`).join('')||'<div style="color:var(--muted);font-size:12px;padding:10px">No users found.</div>';document.querySelectorAll('#user-results input').forEach(c=>c.onchange=e=>{if(e.target.checked)selected.add(Number(e.target.dataset.user));else selected.delete(Number(e.target.dataset.user));});document.querySelectorAll('[data-action="direct"]').forEach(b=>b.onclick=async()=>{try{const {conversation}=await api('/api/conversations/direct',{method:'POST',body:JSON.stringify({userId:Number(b.dataset.user)})});closeModal();await loadConversations();renderConversationList();openConversation(conversation.id);}catch(e){toast(e.message,true)}});}catch(e){toast(e.message,true)}},250);
    document.getElementById('user-search').oninput=search;document.getElementById('create-group').onclick=async()=>{const title=document.getElementById('group-name').value.trim();if(!title||selected.size<1)return toast('Enter a group name and select members',true);try{const {conversation}=await api('/api/conversations/group',{method:'POST',body:JSON.stringify({title,memberIds:[...selected]})});closeModal();await loadConversations();renderConversationList();openConversation(conversation.id);}catch(e){toast(e.message,true)}};
  }
  async function settingsModal(){modal(`<div class="modal-head"><h3>Settings</h3><button class="icon-btn" id="close-modal">×</button></div><div class="form"><div class="field"><label>Display name</label><input id="set-name" value="${esc(state.user.name)}"></div><div class="field"><label>Bio</label><textarea id="set-bio" rows="3">${esc(state.user.bio||'')}</textarea></div><div class="field"><label>Status</label><select id="set-status" style="background:#0a0f17;color:white;border:1px solid var(--line);padding:12px;border-radius:15px"><option>Available</option><option>Away</option><option>Busy</option><option>Invisible</option></select></div><button class="primary" id="save-settings">Save profile</button><button class="secondary" id="logout-btn">Log out</button></div>`);document.getElementById('set-status').value=state.user.status||'Available';document.getElementById('close-modal').onclick=closeModal;document.getElementById('save-settings').onclick=async()=>{try{const {user}=await api('/api/me',{method:'PATCH',body:JSON.stringify({name:document.getElementById('set-name').value,bio:document.getElementById('set-bio').value,status:document.getElementById('set-status').value})});state.user=user;closeModal();renderApp();renderConversationList();toast('Profile updated');if(state.activeId)openConversation(state.activeId);}catch(e){toast(e.message,true)}};document.getElementById('logout-btn').onclick=()=>{state.socket?.disconnect();localStorage.removeItem('nexa_token');state.token=null;state.user=null;closeModal();renderAuth();};}
  function renderDetails(c){const d=document.getElementById('details');if(!d)return;if(c.type==='direct'){const u=c.otherUser;d.innerHTML=`<div class="details-card"><div class="detail-hero">${avatar(u,'avatar')}<strong>${esc(u?.name||c.title)}</strong><span>@${esc(u?.username||'')}</span></div><div class="detail-section"><h4>About</h4><div style="font-size:12px;line-height:1.6;color:var(--muted)">${esc(u?.bio||'No bio yet.')}</div></div><div class="detail-section"><h4>Conversation</h4><div class="detail-row"><span>Status</span><span>${esc(u?.status||'Offline')}</span></div><div class="detail-row"><span>Type</span><span>Direct message</span></div></div></div>`;}else{d.innerHTML=`<div class="details-card"><div class="detail-hero">${avatar({name:c.title,avatar:c.avatar},'avatar')}<strong>${esc(c.title)}</strong><span>Group conversation</span></div><div class="detail-section"><h4>Actions</h4><button class="secondary" style="width:100%;margin-bottom:8px" onclick="window.scrollTo(0,0)">Group settings</button><button class="secondary" style="width:100%">Mute notifications</button></div></div>`;}}
  function modal(html){document.getElementById('modal-root').innerHTML=`<div class="modal"><div class="modal-card glass">${html}</div></div>`}function closeModal(){document.getElementById('modal-root').innerHTML=''}
  function toggleTheme(){state.theme=state.theme==='dark'?'light':'dark';localStorage.setItem('nexa_theme',state.theme);if(state.theme==='light'){document.documentElement.style.setProperty('--bg','#edf1f7');document.documentElement.style.setProperty('--panel','#fff');document.documentElement.style.setProperty('--panel2','#fff');document.documentElement.style.setProperty('--text','#172033');document.documentElement.style.setProperty('--muted','#667085');document.documentElement.style.setProperty('--bubble','#f0f2f7');document.documentElement.style.setProperty('--line','rgba(17,24,39,.09)');document.documentElement.style.setProperty('--mine','#6b56e8')}else{location.reload()}}
  async function globalSearch(q){if(q.trim().length<2)return;try{const {messages}=await api('/api/search?q='+encodeURIComponent(q));modal(`<div class="modal-head"><h3>Search results</h3><button class="icon-btn" id="close-modal">×</button></div>${messages.map(m=>`<button class="user-result" style="width:100%;text-align:left" data-cid="${m.conversation_id}"><div><strong>${esc(m.sender_name)}</strong><div style="color:var(--muted);font-size:12px">${esc(m.body)}</div><small style="color:#78859a">${fmt(m.created_at)}</small></div></button>`).join('')||'<div style="color:var(--muted);font-size:12px">No matching messages.</div>'}`);document.getElementById('close-modal').onclick=closeModal;document.querySelectorAll('[data-cid]').forEach(b=>b.onclick=()=>{closeModal();openConversation(Number(b.dataset.cid))});}catch(e){toast(e.message,true)}}

  if(state.token) boot(); else renderAuth();
})();
