// src/App.js
import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
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
  const chatEndRef = useRef(null);
  const API_URL = 'http://localhost:8000'; // Update this to your API URL

  // Generate a new session on first load
  useEffect(() => {
    fetchSessions();
    generateNewSession();
  }, []);

  // Update input disabled state when uploadedFiles changes
  useEffect(() => {
    setIsInputDisabled(uploadedFiles.length == 0);
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

  const formatDate = (dateString) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    } catch {
      return '';
    }
  };

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
                  <h3>Upload Files</h3>
                  <button 
                    className="close-btn"
                    onClick={() => setIsUploaderOpen(false)}
                  >
                    ×
                  </button>
                </div>
                
                {/* Uploaded Files Section */}
                <div className="uploaded-files-section">
                  <h4>Uploaded Files ({uploadedFiles.length})</h4>
                  <div className="uploaded-files-list">
                    {uploadedFiles.length > 0 ? (
                      uploadedFiles.map((file, index) => (
                        <div key={index} className="uploaded-file-item">
                          <span className="file-icon">
                            {file.status === 'ocr_processed' ? '🔍' : '📄'}
                          </span>
                          <span className="file-name">{file.name}</span>
                          <span className="file-status">
                            {file.status === 'ocr_processed' ? '(OCR Processed)' : ''}
                          </span>
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
                        No files uploaded yet
                      </div>
                    )}
                  </div>
                </div>

                {/* Upload New Files Section */}
                <div className="upload-new-section">
                  <h4>Upload New Files</h4>
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
                        <p className="file-types">Supports PDF, TXT, DOCX</p>
                      </div>
                    </label>
                    <div className="selected-files">
                      {Array.from(selectedFiles).map((file, index) => (
                        <div key={index} className="selected-file">
                          <span className="file-icon">📄</span>
                          <span>{file.name}</span>
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
                    <div className="uploader-actions">
                      <button type="button" className="cancel-btn" onClick={() => setIsUploaderOpen(false)}>
                        Cancel
                      </button>
                      <button type="submit" className="upload-action-btn" disabled={selectedFiles.length === 0 || isUploading}>
                        {isUploading ? 'Uploading...' : `Upload (${selectedFiles.length})`}
                      </button>
                    </div>
                  </form>
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