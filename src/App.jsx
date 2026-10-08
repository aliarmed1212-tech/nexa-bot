
import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

const initialChats = [
  {
    id: 1,
    name: "Alex Johnson",
    username: "@alex",
    avatar: "AJ",
    status: "online",
    lastMessage: "See you tomorrow!",
    time: "10:42 AM",
    unread: 3,
    messages: [
      {
        id: 101,
        sender: "them",
        text: "Hey! How are you doing?",
        time: "10:38 AM",
        reactions: [],
      },
      {
        id: 102,
        sender: "me",
        text: "I'm doing great! Working on the new NEXA project.",
        time: "10:40 AM",
        reactions: ["🔥"],
      },
      {
        id: 103,
        sender: "them",
        text: "That sounds awesome.",
        time: "10:41 AM",
        reactions: [],
      },
      {
        id: 104,
        sender: "them",
        text: "See you tomorrow!",
        time: "10:42 AM",
        reactions: [],
      },
    ],
  },
  {
    id: 2,
    name: "Sarah Williams",
    username: "@sarah",
    avatar: "SW",
    status: "away",
    lastMessage: "Can you send me the file?",
    time: "9:30 AM",
    unread: 1,
    messages: [
      {
        id: 201,
        sender: "them",
        text: "Can you send me the file?",
        time: "9:30 AM",
        reactions: [],
      },
    ],
  },
  {
    id: 3,
    name: "Development Team",
    username: "@devteam",
    avatar: "DT",
    status: "online",
    lastMessage: "The new build is ready.",
    time: "Yesterday",
    unread: 8,
    messages: [
      {
        id: 301,
        sender: "them",
        text: "The new build is ready.",
        time: "Yesterday",
        reactions: [],
      },
    ],
  },
  {
    id: 4,
    name: "Emma Davis",
    username: "@emma",
    avatar: "ED",
    status: "offline",
    lastMessage: "Thanks!",
    time: "Yesterday",
    unread: 0,
    messages: [
      {
        id: 401,
        sender: "me",
        text: "You're welcome!",
        time: "Yesterday",
        reactions: [],
      },
      {
        id: 402,
        sender: "them",
        text: "Thanks!",
        time: "Yesterday",
        reactions: [],
      },
    ],
  },
];

const quickReactions = ["❤️", "👍", "😂", "🔥", "😮", "🎉"];

function App() {
  const [chats, setChats] = useState(initialChats);
  const [selectedChatId, setSelectedChatId] = useState(1);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [darkMode, setDarkMode] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [typing, setTyping] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);

  const selectedChat = chats.find((chat) => chat.id === selectedChatId);

  const filteredChats = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return chats;

    return chats.filter(
      (chat) =>
        chat.name.toLowerCase().includes(query) ||
        chat.username.toLowerCase().includes(query) ||
        chat.lastMessage.toLowerCase().includes(query)
    );
  }, [chats, search]);

  useEffect(() => {
    document.body.classList.toggle("dark-mode", darkMode);

    return () => {
      document.body.classList.remove("dark-mode");
    };
  }, [darkMode]);

  const updateSelectedChat = (callback) => {
    setChats((currentChats) =>
      currentChats.map((chat) =>
        chat.id === selectedChatId ? callback(chat) : chat
      )
    );
  };

  const sendMessage = () => {
    const text = message.trim();

    if (!text && !attachedFile) return;

    const newMessage = {
      id: Date.now(),
      sender: "me",
      text: text || `📎 ${attachedFile.name}`,
      time: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
      reactions: [],
      attachment: attachedFile
        ? {
            name: attachedFile.name,
            type: attachedFile.type,
            size: attachedFile.size,
          }
        : null,
    };

    updateSelectedChat((chat) => ({
      ...chat,
      lastMessage: newMessage.text,
      time: newMessage.time,
      unread: 0,
      messages: [...chat.messages, newMessage],
    }));

    setMessage("");
    setAttachedFile(null);
    setShowEmoji(false);
    setTyping(false);
  };

  const handleTyping = (value) => {
    setMessage(value);
    setTyping(value.length > 0);
  };

  const addReaction = (messageId, reaction) => {
    updateSelectedChat((chat) => ({
      ...chat,
      messages: chat.messages.map((item) => {
        if (item.id !== messageId) return item;

        const hasReaction = item.reactions.includes(reaction);

        return {
          ...item,
          reactions: hasReaction
            ? item.reactions.filter((r) => r !== reaction)
            : [...item.reactions, reaction],
        };
      }),
    }));
  };

  const deleteMessage = (messageId) => {
    updateSelectedChat((chat) => ({
      ...chat,
      messages: chat.messages.filter((item) => item.id !== messageId),
    }));
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    setAttachedFile(file);
  };

  const insertEmoji = (emoji) => {
    setMessage((current) => `${current}${emoji}`);
  };

  const markChatRead = (chatId) => {
    setChats((currentChats) =>
      currentChats.map((chat) =>
        chat.id === chatId ? { ...chat, unread: 0 } : chat
      )
    );
  };

  const openChat = (chatId) => {
    setSelectedChatId(chatId);
    markChatRead(chatId);
  };

  return (
    <div className={`app ${darkMode ? "dark" : "light"}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">N</div>

          <div className="brand-text">
            <h1>NEXA</h1>
            <span>Connect smarter</span>
          </div>
        </div>

        <div className="sidebar-actions">
          <button
            className="primary-button"
            onClick={() => setShowNewChat(true)}
          >
            <span>＋</span>
            New Chat
          </button>
        </div>

        <div className="search-box">
          <span className="search-icon">⌕</span>

          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search chats..."
          />

          {search && (
            <button
              className="clear-search"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        <div className="chat-filter-row">
          <button className="filter active">All</button>
          <button className="filter">Unread</button>
          <button className="filter">Groups</button>
        </div>

        <div className="chat-list">
          {filteredChats.length === 0 ? (
            <div className="empty-chat-list">
              <div className="empty-icon">⌕</div>
              <h3>No conversations</h3>
              <p>Try searching another name or username.</p>
            </div>
          ) : (
            filteredChats.map((chat) => (
              <button
                key={chat.id}
                className={`chat-item ${
                  selectedChatId === chat.id ? "selected" : ""
                }`}
                onClick={() => openChat(chat.id)}
              >
                <div className="avatar-wrapper">
                  <div className="avatar">{chat.avatar}</div>

                  <span
                    className={`presence-dot ${chat.status}`}
                    aria-label={chat.status}
                  />
                </div>

                <div className="chat-item-content">
                  <div className="chat-item-top">
                    <strong>{chat.name}</strong>
                    <span>{chat.time}</span>
                  </div>

                  <div className="chat-item-bottom">
                    <span className="message-preview">
                      {chat.lastMessage}
                    </span>

                    {chat.unread > 0 && (
                      <span className="unread-badge">{chat.unread}</span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="sidebar-bottom">
          <button
            className="sidebar-profile"
            onClick={() => setShowProfile(true)}
          >
            <div className="avatar small">MA</div>

            <div>
              <strong>Muhammad Ali</strong>
              <span>Online</span>
            </div>

            <span className="profile-menu-icon">⋮</span>
          </button>
        </div>
      </aside>

      <main className="chat-area">
        {!selectedChat ? (
          <div className="welcome-screen">
            <div className="welcome-logo">N</div>
            <h2>Welcome to NEXA</h2>
            <p>Select a conversation to start chatting.</p>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <div className="chat-header-user">
                <div className="avatar-wrapper">
                  <div className="avatar">{selectedChat.avatar}</div>
                  <span
                    className={`presence-dot ${selectedChat.status}`}
                  />
                </div>

                <div>
                  <h2>{selectedChat.name}</h2>

                  <div className="status-text">
                    {typing
                      ? "typing..."
                      : selectedChat.status === "online"
                      ? "Online"
                      : selectedChat.status === "away"
                      ? "Away"
                      : "Offline"}
                  </div>
                </div>
              </div>

              <div className="header-actions">
                <button className="icon-button" title="Search">
                  ⌕
                </button>

                <button className="icon-button" title="Voice call">
                  ☎
                </button>

                <button className="icon-button" title="Video call">
                  ◉
                </button>

                <button className="icon-button" title="More options">
                  ⋮
                </button>
              </div>
            </header>

            <section className="messages-container">
              <div className="date-separator">
                <span>Today</span>
              </div>

              {selectedChat.messages.map((item) => (
                <div
                  className={`message-row ${
                    item.sender === "me" ? "outgoing" : "incoming"
                  }`}
                  key={item.id}
                >
                  {item.sender !== "me" && (
                    <div className="message-avatar">{selectedChat.avatar}</div>
                  )}

                  <div className="message-group">
                    <div className="message-bubble">
                      {item.attachment && (
                        <div className="attachment-card">
                          <div className="attachment-icon">📎</div>

                          <div className="attachment-info">
                            <strong>{item.attachment.name}</strong>
                            <span>
                              {formatFileSize(item.attachment.size)}
                            </span>
                          </div>
                        </div>
                      )}

                      {item.text && (
                        <div className="message-text">{item.text}</div>
                      )}

                      <div className="message-meta">
                        <span>{item.time}</span>

                        {item.sender === "me" && (
                          <span className="message-status">✓✓</span>
                        )}
                      </div>
                    </div>

                    {item.reactions.length > 0 && (
                      <div className="reactions">
                        {item.reactions.map((reaction, index) => (
                          <button
                            key={`${reaction}-${index}`}
                            onClick={() => addReaction(item.id, reaction)}
                          >
                            {reaction}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="message-tools">
                      {quickReactions.map((reaction) => (
                        <button
                          key={reaction}
                          onClick={() => addReaction(item.id, reaction)}
                          title={`React ${reaction}`}
                        >
                          {reaction}
                        </button>
                      ))}

                      {item.sender === "me" && (
                        <button
                          onClick={() => deleteMessage(item.id)}
                          title="Delete"
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {typing && (
                <div className="typing-row">
                  <div className="message-avatar">{selectedChat.avatar}</div>

                  <div className="typing-indicator">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
            </section>

            {attachedFile && (
              <div className="attachment-preview">
                <div>
                  <span className="attachment-preview-icon">📎</span>

                  <div>
                    <strong>{attachedFile.name}</strong>
                    <small>{formatFileSize(attachedFile.size)}</small>
                  </div>
                </div>

                <button
                  onClick={() => setAttachedFile(null)}
                  aria-label="Remove attachment"
                >
                  ×
                </button>
              </div>
            )}

            {showEmoji && (
              <div className="emoji-panel">
                {[
                  "😀",
                  "😂",
                  "😍",
                  "🥰",
                  "😎",
                  "🔥",
                  "❤️",
                  "👍",
                  "👏",
                  "🎉",
                  "🚀",
                  "💯",
                  "🤝",
                  "😮",
                  "😢",
                  "🤣",
                  "🙌",
                  "💻",
                  "🎮",
                  "⭐",
                  "✨",
                  "✅",
                ].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            <footer className="composer">
              <label className="composer-button" title="Attach file">
                +
                <input type="file" hidden onChange={handleFileChange} />
              </label>

              <button
                className="composer-button"
                onClick={() => setShowEmoji((current) => !current)}
                title="Emoji"
              >
                ☺
              </button>

              <div className="composer-input-wrapper">
                <textarea
                  value={message}
                  onChange={(event) => handleTyping(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder={`Message ${selectedChat.name}...`}
                  rows={1}
                />
              </div>

              {message.trim() || attachedFile ? (
                <button
                  className="send-button"
                  onClick={sendMessage}
                  title="Send message"
                >
                  ↑
                </button>
              ) : (
                <button className="voice-button" title="Voice message">
                  🎤
                </button>
              )}
            </footer>
          </>
        )}
      </main>

      <aside className="details-panel">
        <div className="details-header">
          <h3>Details</h3>

          <button className="icon-button">×</button>
        </div>

        {selectedChat && (
          <>
            <div className="details-profile">
              <div className="large-avatar">{selectedChat.avatar}</div>

              <h3>{selectedChat.name}</h3>
              <span>{selectedChat.username}</span>

              <div className="profile-actions">
                <button>☎</button>
                <button>◉</button>
                <button>⌕</button>
              </div>
            </div>

            <div className="details-section">
              <h4>Shared Content</h4>

              <button className="details-item">
                <span>▣</span>
                <div>
                  <strong>Media</strong>
                  <small>24 items</small>
                </div>
                <span>›</span>
              </button>

              <button className="details-item">
                <span>▤</span>
                <div>
                  <strong>Files</strong>
                  <small>8 files</small>
                </div>
                <span>›</span>
              </button>

              <button className="details-item">
                <span>🔗</span>
                <div>
                  <strong>Links</strong>
                  <small>13 links</small>
                </div>
                <span>›</span>
              </button>
            </div>

            <div className="details-section">
              <h4>Conversation</h4>

              <button className="details-item">
                <span>🔔</span>
                <div>
                  <strong>Notifications</strong>
                  <small>Enabled</small>
                </div>
                <span>›</span>
              </button>

              <button className="details-item">
                <span>📌</span>
                <div>
                  <strong>Pinned Messages</strong>
                  <small>2 pinned</small>
                </div>
                <span>›</span>
              </button>
            </div>
          </>
        )}

        <div className="theme-control">
          <div>
            <strong>Dark Mode</strong>
            <small>Switch appearance</small>
          </div>

          <button
            className={`toggle ${darkMode ? "on" : ""}`}
            onClick={() => setDarkMode((current) => !current)}
            aria-label="Toggle dark mode"
          >
            <span />
          </button>
        </div>
      </aside>

      {showNewChat && (
        <div className="modal-overlay" onClick={() => setShowNewChat(false)}>
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>New Chat</h2>
                <p>Start a new conversation</p>
              </div>

              <button
                className="icon-button"
                onClick={() => setShowNewChat(false)}
              >
                ×
              </button>
            </div>

            <div className="new-chat-search">
              <span>⌕</span>
              <input placeholder="Search people..." autoFocus />
            </div>

            <div className="new-chat-users">
              {["David Miller", "Sophia Brown", "Daniel Smith"].map(
                (name, index) => (
                  <button
                    className="new-chat-user"
                    key={name}
                    onClick={() => {
                      const newId = Date.now();

                      setChats((current) => [
                        {
                          id: newId,
                          name,
                          username: `@${name
                            .toLowerCase()
                            .replace(/\s+/g, "")}`,
                          avatar: name
                            .split(" ")
                            .map((word) => word[0])
                            .join(""),
                          status: "online",
                          lastMessage: "New conversation",
                          time: "Now",
                          unread: 0,
                          messages: [],
                        },
                        ...current,
                      ]);

                      setSelectedChatId(newId);
                      setShowNewChat(false);
                    }}
                  >
                    <div className="avatar">
                      {name
                        .split(" ")
                        .map((word) => word[0])
                        .join("")}
                    </div>

                    <div>
                      <strong>{name}</strong>
                      <span>
                        {index === 0
                          ? "@david"
                          : index === 1
                          ? "@sophia"
                          : "@daniel"}
                      </span>
                    </div>
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {showProfile && (
        <div className="modal-overlay" onClick={() => setShowProfile(false)}>
          <div
            className="profile-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setShowProfile(false)}
            >
              ×
            </button>

            <div className="profile-cover" />

            <div className="profile-modal-content">
              <div className="profile-large-avatar">MA</div>

              <h2>Muhammad Ali</h2>
              <span>@muhammadali</span>

              <p>
                Building modern software, experimenting with AI, and creating
                beautiful digital experiences.
              </p>

              <div className="profile-stat-grid">
                <div>
                  <strong>{chats.length}</strong>
                  <span>Chats</span>
                </div>

                <div>
                  <strong>128</strong>
                  <span>Messages</span>
                </div>

                <div>
                  <strong>24</strong>
                  <span>Contacts</span>
                </div>
              </div>

              <button
                className="profile-settings-button"
                onClick={() => {
                  setShowProfile(false);
                }}
              >
                ⚙ Account Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes) {
  if (!bytes) return "0 KB";

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));

  return `${(bytes / Math.pow(1024, index)).toFixed(1)} ${units[index]}`;
}

export default App;


