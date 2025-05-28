import os
import json
from datetime import datetime

# Directory to store session memory
MEMORY_DIR = "session_memory"

# Ensure the memory directory exists
os.makedirs(MEMORY_DIR, exist_ok=True)

def get_memory_path(session_id):
    """Get the file path for storing session memory."""
    return os.path.join(MEMORY_DIR, f"{session_id}.json")

def get_metadata_path(session_id):
    """Get the file path for storing session metadata."""
    return os.path.join(MEMORY_DIR, f"{session_id}_metadata.json")

def get_memory(session_id):
    """Retrieve chat history from memory for a session."""
    memory_path = get_memory_path(session_id)
    
    if os.path.exists(memory_path):
        try:
            with open(memory_path, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading memory: {e}")
    
    return []

def save_memory(session_id, chat_history):
    """Save chat history to memory for a session with improved structure."""
    memory_path = get_memory_path(session_id)
    
    try:
        with open(memory_path, "w") as f:
            json.dump(chat_history, f, indent=2)
    except Exception as e:
        print(f"Error saving memory: {e}")

def save_session_metadata(session_id, title):
    """Save session metadata including title and creation time."""
    metadata_path = get_metadata_path(session_id)
    
    # Load existing metadata if it exists
    metadata = {}
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, "r") as f:
                metadata = json.load(f)
        except Exception as e:
            print(f"Error loading existing metadata: {e}")
    
    # Only update title if it's not "Untitled" or we're changing it explicitly
    if "title" not in metadata or metadata["title"] == "Untitled" or title != "Untitled":
        metadata["title"] = title
    
    # Update last_updated timestamp
    metadata["last_updated"] = datetime.now().isoformat()
    
    # Set creation time if not exists
    if "created_at" not in metadata:
        metadata["created_at"] = datetime.now().isoformat()
    
    try:
        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)
    except Exception as e:
        print(f"Error saving metadata: {e}")

def get_session_metadata(session_id):
    """Retrieve session metadata."""
    metadata_path = get_metadata_path(session_id)
    
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading metadata: {e}")
    
    return {
        "session_id": session_id,
        "title": f"Session {session_id[:8]}...",
        "created_at": datetime.now().isoformat(),
        "last_updated": datetime.now().isoformat()
    }

def get_all_sessions_metadata():
    """Get metadata for all sessions."""
    sessions = []
    
    try:
        # Get all session files
        memory_files = [f for f in os.listdir(MEMORY_DIR) if f.endswith('.json') and not f.endswith('_metadata.json')]
        
        for memory_file in memory_files:
            session_id = memory_file.replace('.json', '')
            metadata = get_session_metadata(session_id)
            sessions.append(metadata)
        
        # Sort by last_updated (most recent first)
        sessions.sort(key=lambda x: x.get('last_updated', ''), reverse=True)
        
    except Exception as e:
        print(f"Error getting sessions metadata: {e}")
    
    return sessions

def format_chat_history(chat_history):
    """Format chat history for the RAG chain."""
    formatted = ""
    for message in chat_history:
        if message['type'] == 'HumanMessage':
            formatted += f"Human: {message['content']}\n"
        elif message['type'] == 'AIMessage':
            # Use the active response from alternatives
            active_content = message['alternatives'][message['active_index']] if message.get('alternatives') else message['content']
            formatted += f"AI: {active_content}\n"
    return formatted

def clear_memory(session_id):
    """Delete the memory file for a given session."""
    memory_path = get_memory_path(session_id)
    
    if os.path.exists(memory_path):
        os.remove(memory_path)