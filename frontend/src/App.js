// src/App.js
import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import ImageIcon from '@mui/icons-material/Image';
import DescriptionIcon from '@mui/icons-material/Description';
import './App.css';

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [regenerationCounts, setRegenerationCounts] = useState({});
  const [files, setFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [regeneratingIndex, setRegeneratingIndex] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isInputDisabled, setIsInputDisabled] = useState(true);
  const [tooltipVisible, setToolTipVisible] = useState(false);
  const [webLinks, setWebLinks] = useState(['']);
  const [isAddingLinks, setIsAddingLinks] = useState(false);
  const chatEndRef = useRef(null);
  const API_URL = 'http://localhost:8000'; // Update this to your API URL

  // Generate a new session on first load
  useEffect(() => {
    fetchSessions();
    generateNewSession();
  }, []);

  // Update input disabled state when uploadedFiles changes
  useEffect(() => {
    setIsInputDisabled(uploadedFiles.length === 0);
  }, [uploadedFiles]);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // To load uploaded files when sessionId changes
  useEffect(() => {
    if (sessionId) {
      fetchUploadedFiles(sessionId);
    }
  }, [sessionId]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchSessions = async () => {
    try {
      const response = await fetch(`${API_URL}/sessions`);
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error('Error fetching sessions:', error);
    }
  };

  const generateNewSession = async () => {
    try {
      const response = await fetch(`${API_URL}/generate_session`);
      const data = await response.json();
      setSessionId(data.session_id);
      setMessages([]);
      setUploadedFiles([]);
      
      // Refresh sessions list after creating new session
      setTimeout(fetchSessions, 500);
    } catch (error) {
      console.error('Error generating session:', error);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    
    if (!input.trim()) return;
    
    const userMessage = { 
      text: input, 
      sender: 'user', 
      id: Date.now() + '_user' // Simple ID generation
    };
    setMessages([...messages, userMessage]);
    setInput('');
    setIsLoading(true);
  
    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: sessionId,
          message: input,
        }),
      });
  
      const data = await response.json();
      
      if (data.error) {
        setMessages([...messages, userMessage, { 
          text: data.error, 
          sender: 'bot', 
          isError: true,
          id: Date.now() + '_bot_error'
        }]);
      } else if (data.response) {
        setMessages([...messages, userMessage, { 
          text: data.response, 
          sender: 'bot',
          id: Date.now() + '_bot'
        }]);
        
        if (messages.length === 0) {
          setTimeout(fetchSessions, 500);
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages([...messages, userMessage, { 
        text: 'An error occurred. Please try again later.', 
        sender: 'bot', 
        isError: true,
        id: Date.now() + '_bot_error'
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // To refresh the uploaded files list
  const handleUploadFiles = async (e) => {
    e.preventDefault();
    
    if (selectedFiles.length === 0) return;
    
    const formData = new FormData();
    formData.append('session_id', sessionId);
    
    for (let i = 0; i < selectedFiles.length; i++) {
      formData.append('files', selectedFiles[i]);
    }
    
    try {
      setIsUploading(true);
      const response = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      
      if (data.success) {
        setSelectedFiles([]);
        // Refresh uploaded files list
        fetchUploadedFiles(sessionId);
        setMessages([...messages, { 
          text: `Successfully uploaded ${data.uploaded_files?.length || 0} file(s)`, 
          sender: 'system' 
        }]);
      } else {
        const errorFiles = data.failed_files ? data.failed_files.join(', ') : 'some files';
        setMessages([...messages, { 
          text: `Failed to upload ${errorFiles}`, 
          sender: 'system', 
          isError: true 
        }]);
      }
    } catch (error) {
      console.error('Error uploading files:', error);
      setMessages([...messages, { 
        text: 'Failed to upload files. Please try again.', 
        sender: 'system', 
        isError: true 
      }]);
    } finally {
      setIsUploading(false);
    }
  };

  const fetchChatHistory = async (sessId) => {
    try {
      setIsLoading(true);
      const response = await fetch(`${API_URL}/chat_history?session_id=${sessId}`);
      const data = await response.json();
      
      if (data.history && data.history.length > 0) {
        const formattedMessages = data.history.map(message => ({
          text: message.alternatives && message.alternatives.length > 0 
            ? message.alternatives[message.active_index] 
            : message.content,
          sender: message.type === 'HumanMessage' ? 'user' : 'bot',
          id: message.id,
          alternatives: message.alternatives || [],
          activeIndex: message.active_index || 0
        }));
        
        setMessages(formattedMessages);
      } else {
        setMessages([]);
      }
    } catch (error) {
      console.error('Error fetching chat history:', error);
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileSelect = (e) => {
    setSelectedFiles(Array.from(e.target.files));
  };

  const switchSession = (session) => {
    setSessionId(session.session_id);
    setMessages([]);
    fetchChatHistory(session.session_id);
    fetchUploadedFiles(session.session_id);
  };

  // Fetch uploaded files in each session to show them up later
  const fetchUploadedFiles = async (sessId) => {
    try {
      const response = await fetch(`${API_URL}/uploaded_files?session_id=${sessId}`);
      const data = await response.json();
      if (data.files) {
        setUploadedFiles(data.files);
      } else {
        setUploadedFiles([]);
      }
    } catch (error) {
      console.error('Error fetching uploaded files:', error);
      setUploadedFiles([]);
    }
  };

  // Delete Uploaded Files
  const handleDeleteFile = async (fileName) => {
    if (!window.confirm(`Are you sure you want to delete "${fileName}"?`)) {
      return;
    }
  
    try {
      const response = await fetch(`${API_URL}/delete_file`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: sessionId,
          filename: fileName
        }),
      });
  
      const data = await response.json();
      
      if (data.success) {
        // Refresh the uploaded files list
        fetchUploadedFiles(sessionId);
        setMessages([...messages, { 
          text: `Successfully deleted "${fileName}".`, 
          sender: 'system' 
        }]);
      } else {
        setMessages([...messages, { 
          text: `Failed to delete "${fileName}". ${data.error || ''}`, 
          sender: 'system', 
          isError: true 
        }]);
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      setMessages([...messages, { 
        text: `Failed to delete "${fileName}". Please try again.`, 
        sender: 'system', 
        isError: true 
      }]);
    }
  };

  // Edit the chat name (or session name)
  const startEditingTitle = (session) => {
    setEditingSessionId(session.session_id);
    setEditingTitle(session.title);
  };

  // Save the session name
  const saveTitle = async (sessionId) => {
    try {
      const response = await fetch(`${API_URL}/update_session_title?session_id=${sessionId}&new_title=${encodeURIComponent(editingTitle)}`, {
        method: 'PUT',
      });
      
      if (response.ok) {
        fetchSessions(); // Refresh the sessions list
        setEditingSessionId(null);
        setEditingTitle('');
      }
    } catch (error) {
      console.error('Error updating title:', error);
    }
  };

  const cancelEditing = () => {
    setEditingSessionId(null);
    setEditingTitle('');
  };

  const deleteSession = async (sessionIdToDelete) => {
    if (window.confirm('Are you sure you want to delete this session?')) {
      try {
        const response = await fetch(`${API_URL}/delete_session?session_id=${sessionIdToDelete}`, {
          method: 'DELETE',
        });
        
        if (response.ok) {
          fetchSessions(); // Refresh the sessions list
          // If the deleted session was the current one, create a new session
          if (sessionIdToDelete === sessionId) {
            generateNewSession();
          }
        }
      } catch (error) {
        console.error('Error deleting session:', error);
      }
    }
  };

  const handleAddLinks = async () => {
    try {
      const validLinks = webLinks
        .map(link => link.trim())
        .filter(link => link && isValidUrl(link));
      
      if (validLinks.length === 0) {
        alert('Please enter valid URLs starting with http:// or https://');
        return;
      }
  
      const response = await fetch(`${API_URL}/add_web_links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          urls: validLinks
        })
      });
  
      const data = await response.json();
      
      if (data.success) {
        // Refresh files list
        fetchUploadedFiles(sessionId);
        setMessages([...messages, { 
          text: `Successfully added ${data.scraped_urls?.length || 0} web page(s)`, 
          sender: 'system' 
        }]);
        setIsAddingLinks(false);
        setWebLinks(['']);
      } else {
        const failed = data.failed_urls ? data.failed_urls.join(', ') : 'some URLs';
        setMessages([...messages, { 
          text: `Failed to process ${failed}`, 
          sender: 'system', 
          isError: true 
        }]);
      }
    } catch (error) {
      console.error('Error adding web links:', error);
      setMessages([...messages, { 
        text: 'Failed to add web links. Please try again.', 
        sender: 'system', 
        isError: true 
      }]);
    }
  };
  
  // URL validation helper
  const isValidUrl = (url) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  // Add humanFileSize function
  const humanFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Add formatDate function (simplified)
  const formatDate = (timestamp) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString([], { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Icon components
  const FileIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M13 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V9L13 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13 2V9H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  const GlobeIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 12H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 2C14.5013 4.73835 15.9228 8.29203 16 12C15.9228 15.708 14.5013 19.2616 12 22C9.49872 19.2616 8.07725 15.708 8 12C8.07725 8.29203 9.49872 4.73835 12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  const PublishIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M440-160v-326L336-382l-56-58 200-200 200 200-56 58-104-104v326h-80ZM160-600v-120q0-33 23.5-56.5T240-800h480q33 0 56.5 23.5T800-720v120h-80v-120H240v120h-80Z"/></svg>  
  );

  // Regenerate response
  const handleRegenerate = async (messageIndex) => {
    const botMessage = messages[messageIndex];
    if (!botMessage || botMessage.sender !== 'bot') return;
    
    const userMessage = messages[messageIndex - 1];
    if (!userMessage || userMessage.sender !== 'user') return;
  
    // Check regeneration limit
    const currentCount = botMessage.regeneration_count || 0;
    if (currentCount >= 3) {
      alert('Maximum regeneration limit (3) reached for this response');
      return;
    }
  
    setRegeneratingIndex(messageIndex);
  
    try {
      const response = await fetch(`${API_URL}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          message: userMessage.text
        })
      });
      
      const data = await response.json();
      
      if (data.response) {
        const newMessages = [...messages];
        const currentBotMessage = newMessages[messageIndex];
        
        if (!currentBotMessage.alternatives) {
          currentBotMessage.alternatives = [currentBotMessage.text];
          currentBotMessage.activeIndex = 0;
        }
        
        currentBotMessage.alternatives.push(data.response);
        currentBotMessage.activeIndex = currentBotMessage.alternatives.length - 1;
        currentBotMessage.text = data.response;
        currentBotMessage.regeneration_count = data.regeneration_count;
        
        setMessages(newMessages);
      }
    } catch (error) {
      console.error('Error regenerating response:', error);
    } finally {
      setRegeneratingIndex(null);
    }
  };

  // Move through responses
  const navigateAlternatives = (messageIndex, direction) => {
    const newMessages = [...messages];
    const message = newMessages[messageIndex];
    
    if (!message.alternatives || message.alternatives.length <= 1) return;
    
    let newIndex = message.activeIndex + direction;
    
    // Wrap around
    if (newIndex < 0) {
      newIndex = message.alternatives.length - 1;
    } else if (newIndex >= message.alternatives.length) {
      newIndex = 0;
    }
    
    message.activeIndex = newIndex;
    message.text = message.alternatives[newIndex];
    
    setMessages(newMessages);
  };

  // Function to render message content with Markdown if it's from the bot
  const renderMessage = (message, index) => {
    if (message.sender === 'bot') {
      const hasAlternatives = message.alternatives && message.alternatives.length > 1;
      const currentIndex = message.activeIndex || 0;
      const totalAlternatives = message.alternatives ? message.alternatives.length : 1;
      const regenerationCount = message.regeneration_count || 0;
      const canRegenerate = regenerationCount < 3;
      
      return (
        <div className="bot-message-container">
          <div className={`message-content ${message.isError ? 'error' : ''}`}>
            <ReactMarkdown>{message.text}</ReactMarkdown>
          </div>
          <div className="bot-message-controls">
            {hasAlternatives && (
              <div className="alternatives-navigation">
                <button 
                  className="nav-btn"
                  onClick={() => navigateAlternatives(index, -1)}
                  title="Previous alternative"
                >
                  ←
                </button>
                <span className="alternatives-counter">
                  {currentIndex + 1} / {totalAlternatives}
                </span>
                <button 
                  className="nav-btn"
                  onClick={() => navigateAlternatives(index, 1)}
                  title="Next alternative"
                >
                  →
                </button>
              </div>
            )}
            <div className="regenerate-section">
              <button 
                className="regenerate-btn"
                onClick={() => handleRegenerate(index)}
                disabled={regeneratingIndex === index || !canRegenerate}
                title={canRegenerate ? "Regenerate response" : "Maximum regenerations reached"}
              >
                {regeneratingIndex === index ? '⟳' : '🔄'}
              </button>
              {regenerationCount > 0 && (
                <span className="regeneration-count">
                  {regenerationCount}/3
                </span>
              )}
            </div>
          </div>
        </div>
      );
    } else {
      return (
        <div className={`message-content ${message.isError ? 'error' : ''}`}>
          {message.text}
        </div>
      );
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
        <button className="new-chat-btn" onClick={generateNewSession}>
          <div className="new-chat-icon">+</div>
          <span>New Chat</span>
        </button>
        <div className="sessions-list">
          {sessions.map((session) => (
            <div 
              key={session.session_id} 
              className={`session-item ${session.session_id === sessionId ? 'active' : ''}`}
            >
              {editingSessionId === session.session_id ? (
                <div className="session-edit" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        saveTitle(session.session_id);
                      } else if (e.key === 'Escape') {
                        cancelEditing();
                      }
                    }}
                    onBlur={() => cancelEditing()}
                    className="session-title-input"
                    autoFocus
                  />
                  <div className="session-edit-buttons">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        saveTitle(session.session_id);
                      }}
                    >
                      ✓
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelEditing();
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <div 
                  className="session-content"
                  onClick={() => switchSession(session)}
                >
                  <div className="session-icon">💬</div>
                  <div className="session-info">
                    <div className="session-title">{session.title}</div>
                    <div className="session-date">{formatDate(session.last_updated)}</div>
                  </div>
                  <div className="session-actions">
                    <button 
                      className="session-action-btn edit-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditingTitle(session);
                      }}
                    >
                      ✏️
                    </button>
                    <button 
                      className="session-action-btn delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(session.session_id);
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`main-content ${isSidebarOpen ? '' : 'sidebar-closed'}`}>
        <div className="chat-header">
          <button 
            className="sidebar-toggle" 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          >
            <div className="hamburger-icon">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </button>
          <span className="session-name">
          {sessions.find(s => s.session_id === sessionId)?.title || "Untitled"}
          </span>
        </div>

        <div className="chat-container">
          <div className="messages-container">
            {messages.length === 0 && (
              <div className="welcome-message">
                <div className="header-logo">
                  <img src="GlokalAI-LOGO.png" alt="Glokal AI" className="logo-img" />
                </div>
                <p>Upload documents to get started</p>
              </div>
            )}
            
            {messages.map((message, index) => (
              <div key={index} className={`message ${message.sender}`}>
                <div className="message-avatar">
                  {message.sender === 'user' ? '👤' : '🤖'}
                </div>
                <div className="message-content-container">
                  {renderMessage(message, index)}
                </div>
              </div>
            ))}
            
            {isLoading && (
              <div className="message bot">
                <div className="message-avatar">🤖</div>
                <div className="message-content-container">
                  <div className="message-content loading">
                    <div className="typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* File Uploader Dialog */}
          {isUploaderOpen && (
            <div className="uploader-overlay">
              <div className="uploader-container">
                <div className="uploader-header">
                  <h3>Add Content to Session</h3>
                  <button 
                    className="close-btn"
                    onClick={() => {
                      setIsUploaderOpen(false);
                      setIsAddingLinks(false);
                      setWebLinks(['']);
                    }}
                  >
                    ×
                  </button>
                </div>
                
                {/* Content Tabs */}
                <div className="content-tabs">
                  <button 
                    className={`tab-btn ${!isAddingLinks ? 'active' : ''}`}
                    onClick={() => setIsAddingLinks(false)}
                  >
                    <FileIcon /> Files
                  </button>
                  <button 
                    className={`tab-btn ${isAddingLinks ? 'active' : ''}`}
                    onClick={() => setIsAddingLinks(true)}
                  >
                    <GlobeIcon /> Web Links
                  </button>
                </div>
                
                {/* Uploaded Files Section - Always visible */}
                <div className="uploaded-files-section">
                  <h4>Current Content ({uploadedFiles.length})</h4>
                  <div className="uploaded-files-list">
                    {uploadedFiles.length > 0 ? (
                      uploadedFiles.map((file, index) => (
                        <div key={index} className="uploaded-file-item">
                          <span className="file-icon">
                            {file.type === "webpage" ? (
                              <GlobeIcon />
                            ) : file.is_image ? (
                              <ImageIcon />
                            ) : (
                              <DescriptionIcon />
                            )}
                          </span>

                          {file.original_url ? (
                            <div className="file-info">
                              <a 
                                href={file.original_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="file-url"
                              >
                                {file.original_url}
                              </a>
                              <div className="file-meta">
                                {humanFileSize(file.size)} • {formatDate(file.modified)}
                              </div>
                            </div>
                          ) : (
                            <div className="file-info">
                              <span className="file-name">{file.name}</span>
                              <div className="file-meta">
                                {humanFileSize(file.size)} • {formatDate(file.modified)}
                              </div>
                            </div>
                          )}

                          <button 
                            className="delete-file-btn"
                            onClick={() => handleDeleteFile(file.name)}
                            title="Delete file"
                          >
                            🗑️
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="no-files-message">
                        <span className="empty-icon">📂</span>
                        No content added yet
                      </div>
                    )}
                  </div>
                </div>

                {/* Dynamic Content Section */}
                <div className="content-section">
                  {isAddingLinks ? (
                    <div className="web-links-section">
                      <h5>Add Web Pages</h5>
                      <p className="section-description">
                        Enter URLs to extract content from websites
                      </p>
                      
                      <div className="link-inputs-container">
                        {webLinks.map((link, index) => (
                          <div key={index} className="link-input-group">
                            <div className="link-counter">{index + 1}</div>
                            <input
                              type="text"
                              value={link}
                              onChange={(e) => {
                                const newLinks = [...webLinks];
                                newLinks[index] = e.target.value;
                                setWebLinks(newLinks);
                              }}
                              placeholder="https://example.com"
                              className="link-input"
                            />
                            <div className="link-actions">
                              {index === webLinks.length - 1 && (
                                <button
                                  type="button"
                                  onClick={() => setWebLinks([...webLinks, ''])}
                                  className="icon-btn add-btn"
                                  title="Add another URL"
                                >
                                  +
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  if (webLinks.length > 1) {
                                    const newLinks = [...webLinks];
                                    newLinks.splice(index, 1);
                                    setWebLinks(newLinks);
                                  } else {
                                    setWebLinks(['']);
                                  }
                                }}
                                className="icon-btn remove-btn"
                                title="Remove URL"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="link-tips" >
                        <span className="tip-icon">💡</span>
                        <span>Tip: Use direct URLs to articles or documentation for best results</span>
                      </div>
                      
                      <div className="section-actions">
                        <button
                          type="button"
                          className="action-btn secondary"
                          onClick={() => setIsAddingLinks(false)}
                        >
                          Back to Files
                        </button>
                        <button
                          type="button"
                          className="action-btn primary"
                          onClick={handleAddLinks}
                          disabled={webLinks.every(link => !link.trim())}
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="file-upload-section">
                      <h5>Upload Files</h5>
                      <p className="section-description">Add documents to chat with</p>
                      
                      <form onSubmit={handleUploadFiles} className="upload-form">
                        <label className="file-drop-area">
                          <input 
                            type="file" 
                            multiple 
                            onChange={handleFileSelect} 
                            className="file-input"
                          />
                          <div className="drop-instructions">
                            <div className="upload-icon">📤</div>
                            <p>Click to browse or drag files here</p>
                            <p className="file-types">Supports PDF, TXT, DOCX, Images</p>
                          </div>
                        </label>
                        
                        {selectedFiles.length > 0 && (
                          <div className="selected-files-container">
                            <div className="selected-files-header">
                              <span>Selected Files ({selectedFiles.length})</span>
                              <button
                                type="button"
                                onClick={() => setSelectedFiles([])}
                                className="clear-all-btn"
                              >
                                Clear All
                              </button>
                            </div>
                            <div className="selected-files">
                              {Array.from(selectedFiles).map((file, index) => (
                                <div key={index} className="selected-file">
                                  <span className="file-icon">📄</span>
                                  <span className="file-name">{file.name}</span>
                                  <span className="file-size">
                                    {(file.size / 1024 / 1024).toFixed(2)} MB
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newFiles = Array.from(selectedFiles).filter((_, i) => i !== index);
                                      setSelectedFiles(newFiles);
                                    }}
                                    className="remove-selected-btn"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        <div className="section-actions">
                          <button
                            type="button"
                            className="action-btn secondary"
                            onClick={() => setIsUploaderOpen(false)}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="action-btn primary"
                            disabled={selectedFiles.length === 0 || isUploading}
                          >
                            {isUploading ? 'Uploading...' : `Upload Files (${selectedFiles.length})`}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Input Area */}
          <div
            className="input-container"
            onMouseEnter={() => isInputDisabled && setToolTipVisible(true)}
            onMouseLeave={() => setToolTipVisible(false)}
          >
            <form onSubmit={handleSendMessage} className="input-form">
              <button 
                className="upload-btn" 
                onClick={() => setIsUploaderOpen(true)}
                type="button"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M9 17V11L7 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9 11L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M22 10V15C22 20 20 22 15 22H9C4 22 2 20 2 15V9C2 4 4 2 9 2H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M22 10H18C15 10 14 9 14 6V2L22 10Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isInputDisabled ? "Upload a file to enable chatting" : "Let Glokal AI know your thoughts..."}
                disabled={isInputDisabled || isLoading}
                className={`message-input ${isInputDisabled ? 'disabled' : ''}`}
              />
              <button 
                type="submit" 
                disabled={isInputDisabled || !input.trim() || isLoading}
                className="send-btn"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </form>
            <div className="input-footer">
              <p>GlokalAI can make mistakes. Verify important information.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;