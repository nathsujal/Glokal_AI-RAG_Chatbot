from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from rag_chain import build_chain
from memory_store import (
    get_memory, save_memory, format_chat_history, clear_memory, 
    save_session_metadata, get_session_metadata, get_all_sessions_metadata
)
from langchain_core.messages import HumanMessage, AIMessage
from typing import Dict, Any, List, Optional
import uuid
import os
import shutil
import re
import logging
import traceback
from pathlib import Path
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from bs4 import BeautifulSoup
import requests
from urllib.parse import urlparse
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

UPLOAD_DIR = "uploaded_docs"
MEMORY_DIR = "session_memory"

# Ensure directories exist
Path(UPLOAD_DIR).mkdir(exist_ok=True)
Path(MEMORY_DIR).mkdir(exist_ok=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting FastAPI application")
    yield
    # Shutdown
    logger.info("Shutting down FastAPI application")

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to your frontend URL for security
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatInput(BaseModel):
    session_id: str
    message: str

class UpdateTitleRequest(BaseModel):
    session_id: str
    new_title: str

class DeleteFileRequest(BaseModel):
    session_id: str
    filename: str

class SaveAlternativesRequest(BaseModel):
    session_id: str
    message_id: str
    alternatives: List[str]

class WebLinksInput(BaseModel):
    session_id: str
    urls: List[str]

def generate_chat_title(first_message: str) -> str:
    """Generate a meaningful chat title from the first user message."""
    try:
        # Clean and truncate the message
        title = re.sub(r'[^\w\s-]', '', first_message).strip()
        # Take first 50 characters and add ellipsis if longer
        if len(title) > 50:
            title = title[:50] + "..."
        # If title is empty or too short, provide a default
        if len(title) < 3:
            title = "New Chat"
        return title
    except Exception as e:
        logger.error(f"Error generating chat title: {e}")
        return "New Chat"

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Global exception handler caught: {exc}")
    logger.error(f"Traceback: {traceback.format_exc()}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc) if app.debug else "An unexpected error occurred"
        }
    )

@app.post("/chat")
async def chat(request: ChatInput):
    """Handle chat messages with improved error handling."""
    try:
        session_id = request.session_id
        user_input = request.message

        # Document check
        doc_dir = os.path.join(UPLOAD_DIR, session_id)
        if not os.path.exists(doc_dir) or not any(os.scandir(doc_dir)):
            return JSONResponse(
                status_code=200,
                content={
                    "error": "Please upload at least one document or add web links before chatting",
                    "response": None,
                    "session_id": session_id
                }
            )

        # Validate inputs
        if not session_id or not session_id.strip():
            return JSONResponse(
                status_code=400,
                content={
                    "error": "Invalid session ID",
                    "response": None,
                    "session_id": session_id
                }
            )

        if not user_input or not user_input.strip():
            return JSONResponse(
                status_code=400,
                content={
                    "error": "Message cannot be empty",
                    "response": None,
                    "session_id": session_id
                }
            )

        # Get chat history with error handling
        try:
            chat_history = get_memory(session_id)
        except Exception as e:
            logger.error(f"Error getting memory for session {session_id}: {e}")
            chat_history = []
        
        # If this is the first message, generate and save a title
        if len(chat_history) == 0:
            try:
                title = generate_chat_title(user_input)
                save_session_metadata(session_id, title)
            except Exception as e:
                logger.error(f"Error saving session metadata: {e}")
        
        # Format chat history as a string for the RAG chain
        try:
            formatted_history = format_chat_history(chat_history)
        except Exception as e:
            logger.error(f"Error formatting chat history: {e}")
            formatted_history = ""
            
        # Get the RAG chain with timeout
        try:
            rag_chain = build_chain(session_id)
        except Exception as e:
            logger.error(f"Error building RAG chain: {e}")
            return JSONResponse(
                status_code=500,
                content={
                    "error": "Failed to initialize chat system. Please try again.",
                    "response": None,
                    "session_id": session_id
                }
            )
            
        # Process the user input with timeout and error handling
        try:
            # Add timeout to prevent hanging
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    rag_chain.invoke,
                    {
                        "question": user_input,
                        "chat_history": formatted_history
                    }
                ),
                timeout=60.0  # 60 second timeout
            )
            
            logger.info(f"Generated response for session {session_id}")
            
        except asyncio.TimeoutError:
            logger.error(f"RAG chain timeout for session {session_id}")
            return JSONResponse(
                status_code=500,
                content={
                    "error": "Request timed out. Please try again with a shorter message.",
                    "response": None,
                    "session_id": session_id
                }
            )
        except Exception as e:
            logger.error(f"Error invoking RAG chain: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            return JSONResponse(
                status_code=500,
                content={
                    "error": "Failed to generate response. Please check your documents and try again.",
                    "response": None,
                    "session_id": session_id
                }
            )
            
        # Update chat history with error handling
        try:
            # Add human message
            chat_history.append({
                'content': user_input,
                'type': 'HumanMessage',
                'id': str(uuid.uuid4()),
                'timestamp': datetime.now().isoformat()
            })
            
            # Add AI's response with alternatives structure
            chat_history.append({
                'content': response,
                'type': 'AIMessage',
                'id': str(uuid.uuid4()),
                'alternatives': [response],  # Initialize with first response
                'active_index': 0,
                'regeneration_count': 0,
                'timestamp': datetime.now().isoformat()
            })
            
            save_memory(session_id, chat_history)
        except Exception as e:
            logger.error(f"Error saving chat history: {e}")
            
        return JSONResponse(
            status_code=200,
            content={
                "response": response,
                "session_id": session_id
            }
        )
        
    except ValidationError as e:
        logger.error(f"Validation error in chat endpoint: {e}")
        return JSONResponse(
            status_code=400,
            content={
                "error": "Invalid request format",
                "response": None,
                "session_id": getattr(request, 'session_id', None)
            }
        )
    except Exception as e:
        logger.error(f"Unexpected error in chat endpoint: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return JSONResponse(
            status_code=500,
            content={
                "error": "An unexpected error occurred. Please try again.",
                "response": None,
                "session_id": getattr(request, 'session_id', None)
            }
        )
    
@app.post("/regenerate")
async def regenerate_response(request: ChatInput):
    """Regenerate response for a specific query with regeneration prompt."""
    try:
        session_id = request.session_id
        user_input = request.message

        # Validate inputs
        if not session_id or not session_id.strip():
            return JSONResponse(
                status_code=400,
                content={
                    "error": "Invalid session ID",
                    "response": None,
                    "session_id": session_id
                }
            )

        # Check if files uploaded for this session
        doc_dir = os.path.join(UPLOAD_DIR, session_id)
        if not os.path.exists(doc_dir) or not any(os.scandir(doc_dir)):
            return JSONResponse(
                status_code=200,
                content={
                    "error": "Please upload at least one document before starting a chat.",
                    "response": None,
                    "session_id": session_id
                }
            )

        # Get chat history
        chat_history = get_memory(session_id)
        
        # Find the last AI message for this user input
        last_ai_message = None
        for i in range(len(chat_history) - 1, -1, -1):
            if (chat_history[i]['type'] == 'AIMessage' and 
                i > 0 and 
                chat_history[i-1]['type'] == 'HumanMessage' and 
                chat_history[i-1]['content'] == user_input):
                last_ai_message = chat_history[i]
                break
        
        if not last_ai_message:
            return JSONResponse(
                status_code=400,
                content={"error": "No matching AI response found for regeneration"}
            )
        
        # Check regeneration limit
        if last_ai_message.get('regeneration_count', 0) >= 3:
            return JSONResponse(
                status_code=400,
                content={"error": "Maximum regeneration limit (3) reached for this response"}
            )
        
        # Format chat history for RAG chain (exclude alternatives from the message being regenerated)
        formatted_history = format_chat_history(chat_history[:-1] if chat_history else [])
        
        # Create regeneration prompt
        regeneration_prompt = f"""
Please provide an alternative response to the user's question. 
- Generate a different perspective or approach compared to previous responses
- Maintain accuracy and relevance to the documents
- Keep the same helpful and conversational tone
- Avoid repeating the exact same information in the same way

Previous responses given: {len(last_ai_message.get('alternatives', []))}
User's original question: {user_input}
"""
        
        # Get the RAG chain
        rag_chain = build_chain(session_id)
        
        # Generate new response with regeneration context
        response = await asyncio.wait_for(
            asyncio.to_thread(
                rag_chain.invoke,
                {
                    "question": f"{regeneration_prompt}\n\nOriginal Question: {user_input}",
                    "chat_history": formatted_history
                }
            ),
            timeout=60.0
        )
        
        # Update the AI message with new alternative
        if not last_ai_message.get('alternatives'):
            last_ai_message['alternatives'] = [last_ai_message['content']]
        
        last_ai_message['alternatives'].append(response)
        last_ai_message['active_index'] = len(last_ai_message['alternatives']) - 1
        last_ai_message['content'] = response  # Update current content
        last_ai_message['regeneration_count'] = last_ai_message.get('regeneration_count', 0) + 1
        
        # Save updated chat history
        save_memory(session_id, chat_history)
        
        return JSONResponse(
            status_code=200,
            content={
                "response": response,
                "session_id": session_id,
                "alternatives_count": len(last_ai_message['alternatives']),
                "regeneration_count": last_ai_message['regeneration_count']
            }
        )
        
    except Exception as e:
        logger.error(f"Error in regenerate endpoint: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "error": "Failed to regenerate response",
                "response": None,
                "session_id": getattr(request, 'session_id', None)
            }
        )
    
@app.post("/save_regeneration_prompt")
async def save_regeneration_prompt(session_id: str, message_id: str, prompt: str):
    try:
        chat_history = get_memory(session_id)
        for msg in chat_history:
            if msg['id'] == message_id and msg['type'] == 'AIMessage':
                msg['regeneration_prompt'] = prompt
                save_memory(session_id, chat_history)
                return {"success": True}
        return {"success": False, "error": "Message not found"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/generate_session")
async def generate_session():
    """Generate a new session ID with default title."""
    try:
        session_id = str(uuid.uuid4())
        default_title = "Untitled"
        
        # Save session metadata with default title
        save_session_metadata(session_id, default_title)
        
        logger.info(f"Generated new session: {session_id} with title: {default_title}")
        return {"session_id": session_id}
    except Exception as e:
        logger.error(f"Error generating session: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate session")

@app.post("/add_web_links")
async def add_web_links(request: WebLinksInput):
    try:
        session_id = request.session_id
        urls = request.urls
        
        if not session_id or not session_id.strip():
            raise HTTPException(status_code=400, detail="Invalid session ID")
        
        if not urls:
            raise HTTPException(status_code=400, detail="No URLs provided")

        # Create directory for this session
        upload_dir = Path(UPLOAD_DIR) / session_id
        upload_dir.mkdir(parents=True, exist_ok=True)

        scraped_urls = []
        failed_urls = []
        metadata_path = os.path.join(MEMORY_DIR, f"{session_id}_files.json")
        file_metadata = {}

        # Load existing metadata if available
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, "r") as f:
                    file_metadata = json.load(f)
            except:
                pass

        for url in urls:
            try:
                # Validate URL format
                if not re.match(r'^https?://', url):
                    url = 'https://' + url
                
                # Scrape content
                response = requests.get(url, timeout=10)
                response.raise_for_status()
                
                # Parse HTML
                soup = BeautifulSoup(response.text, 'html.parser')
                
                # Extract meaningful content
                for script in soup(["script", "style"]):
                    script.extract()
                
                text = soup.get_text()
                lines = (line.strip() for line in text.splitlines())
                chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
                clean_text = '\n'.join(chunk for chunk in chunks if chunk)
                
                # Generate filename
                domain = urlparse(url).netloc
                filename = f"{domain}_{datetime.now().strftime('%Y%m%d%H%M%S')}.txt"
                file_path = upload_dir / filename
                
                # Save metadata
                file_metadata[filename] = {
                    "original_url": url,
                    "type": "webpage",
                    "scraped_at": datetime.now().isoformat()
                }

                # Save content
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(f"URL: {url}\n\n")
                    f.write(clean_text)
                
                scraped_urls.append({
                    "url": url,
                    "filename": filename,
                    "size": len(clean_text)
                })
                
            except Exception as e:
                logger.error(f"Error scraping {url}: {e}")
                failed_urls.append(url)

        # Save metadata
        with open(metadata_path, "w") as f:
            json.dump(file_metadata, f, indent=2)
        
        result = {"success": len(scraped_urls) > 0}
        if scraped_urls:
            result["scraped_urls"] = scraped_urls
        if failed_urls:
            result["failed_urls"] = failed_urls
            
        return result

    except Exception as e:
        logger.error(f"Error in web link endpoint: {e}")
        raise HTTPException(status_code=500, detail="Failed to process web links")
    
@app.post("/upload")
async def upload_files(
    session_id: str = Form(...),
    files: List[UploadFile] = File(...)
):
    try:
        if not session_id or not session_id.strip():
            raise HTTPException(status_code=400, detail="Invalid session ID")
        
        if not files:
            raise HTTPException(status_code=400, detail="No files provided")

        # Create directory for this session
        upload_dir = Path(UPLOAD_DIR) / session_id
        upload_dir.mkdir(parents=True, exist_ok=True)

        uploaded_files = []
        failed_files = []

        # Save each uploaded file
        for file in files:
            if not file.filename:
                failed_files.append("Unnamed file")
                continue
                
            try:
                file_path = upload_dir / file.filename
                
                # Check file size (limit to 10MB)
                content = await file.read()
                if len(content) > 10 * 1024 * 1024:  # 10MB
                    failed_files.append(f"{file.filename} (too large)")
                    continue
                
                # Write file
                with open(file_path, "wb") as f:
                    f.write(content)
                    
                uploaded_files.append(file.filename)
                logger.info(f"Uploaded file: {file.filename} for session {session_id}")
                
            except Exception as e:
                logger.error(f"Error uploading file {file.filename}: {e}")
                failed_files.append(f"{file.filename} (upload failed)")

        result = {"success": len(uploaded_files) > 0}
        if uploaded_files:
            result["uploaded_files"] = uploaded_files
        if failed_files:
            result["failed_files"] = failed_files

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in upload endpoint: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload files")

@app.post("/select_alternative")
async def select_alternative(request: dict):
    """Select a specific alternative response."""
    try:
        session_id = request.get('session_id')
        message_id = request.get('message_id')
        alternative_index = request.get('alternative_index')
        
        if not all([session_id, message_id is not None, alternative_index is not None]):
            raise HTTPException(status_code=400, detail="Missing required parameters")
        
        chat_history = get_memory(session_id)
        
        # Find and update the message
        for message in chat_history:
            if (message['id'] == message_id and 
                message['type'] == 'AIMessage' and 
                message.get('alternatives')):
                
                if 0 <= alternative_index < len(message['alternatives']):
                    message['active_index'] = alternative_index
                    message['content'] = message['alternatives'][alternative_index]
                    save_memory(session_id, chat_history)
                    return {"success": True}
                else:
                    raise HTTPException(status_code=400, detail="Invalid alternative index")
        
        raise HTTPException(status_code=404, detail="Message not found")
        
    except Exception as e:
        logger.error(f"Error selecting alternative: {e}")
        raise HTTPException(status_code=500, detail="Failed to select alternative")

@app.get("/sessions")
async def list_sessions():
    """List all sessions with error handling."""
    try:
        sessions_data = get_all_sessions_metadata()
        return {"sessions": sessions_data}
    except Exception as e:
        logger.error(f"Error listing sessions: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve sessions")

@app.get("/chat_history")
async def get_chat_history(session_id: str):
    try:
        if not session_id or not session_id.strip():
            raise HTTPException(status_code=400, detail="Invalid session ID")

        chat_history = get_memory(session_id)
        
        if not chat_history:
            return {"history": [], "session_id": session_id}
        
        return {
            "history": chat_history,
            "session_id": session_id
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving chat history: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve chat history")

@app.post("/update_chat_history")
async def update_chat_history(request: dict):
    """Update chat history with new alternatives."""
    try:
        session_id = request.get('session_id')
        frontend_messages = request.get('messages', [])
        
        if not session_id:
            raise HTTPException(status_code=400, detail="Session ID required")
        
        # Convert frontend messages back to storage format
        chat_history = []
        for msg in frontend_messages:
            if msg['sender'] == 'user':
                chat_history.append({
                    'content': msg['text'],
                    'type': 'HumanMessage',
                    'alternatives': [],
                    'active_index': 0,
                    'id': msg['id']
                })
            else:  # bot
                chat_history.append({
                    'content': msg['text'],
                    'type': 'AIMessage',
                    'alternatives': msg.get('alternatives', [msg['text']]),
                    'active_index': msg.get('activeIndex', 0),
                    'id': msg['id']
                })
        
        save_memory(session_id, chat_history)
        return {"success": True}
        
    except Exception as e:
        logger.error(f"Error updating chat history: {e}")
        raise HTTPException(status_code=500, detail="Failed to update chat history")
    
@app.put("/update_session_title")
async def update_session_title(request: UpdateTitleRequest):
    """Update the title of a session."""
    try:
        if not request.session_id or not request.session_id.strip():
            raise HTTPException(status_code=400, detail="Invalid session ID")
        
        if not request.new_title or not request.new_title.strip():
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        
        # Sanitize title
        clean_title = request.new_title.strip()[:100]  # Limit length
        
        save_session_metadata(request.session_id, clean_title)
        return {
            "success": True, 
            "session_id": request.session_id, 
            "title": clean_title
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating session title: {e}")
        raise HTTPException(status_code=500, detail="Failed to update session title")

@app.delete("/delete_session")
async def delete_session(session_id: str):
    """Delete a session and all its associated data."""
    try:
        if not session_id or not session_id.strip():
            raise HTTPException(status_code=400, detail="Invalid session ID")

        # Delete memory file
        try:
            clear_memory(session_id)
        except Exception as e:
            logger.warning(f"Error clearing memory for session {session_id}: {e}")
        
        # Delete session metadata
        try:
            metadata_path = os.path.join(MEMORY_DIR, f"{session_id}_metadata.json")
            if os.path.exists(metadata_path):
                os.remove(metadata_path)
        except Exception as e:
            logger.warning(f"Error deleting metadata for session {session_id}: {e}")
        
        # Delete uploaded documents
        try:
            doc_dir = os.path.join(UPLOAD_DIR, session_id)
            if os.path.exists(doc_dir):
                shutil.rmtree(doc_dir)
        except Exception as e:
            logger.warning(f"Error deleting documents for session {session_id}: {e}")
        
        logger.info(f"Deleted session: {session_id}")
        return {"success": True, "session_id": session_id}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting session: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete session")

@app.delete("/delete_file")
async def delete_file(request: DeleteFileRequest):
    """Delete a specific file from a session."""
    try:
        if not request.session_id or not request.session_id.strip():
            raise HTTPException(status_code=400, detail="Invalid session ID")
        
        if not request.filename or not request.filename.strip():
            raise HTTPException(status_code=400, detail="Invalid filename")
        
        # Sanitize filename to prevent path traversal
        safe_filename = os.path.basename(request.filename)
        
        # Construct the file path
        file_path = os.path.join(UPLOAD_DIR, request.session_id, safe_filename)
        
        # Check if file exists
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found")
        
        # Delete the file
        os.remove(file_path)
        
        logger.info(f"Deleted file: {safe_filename} from session {request.session_id}")
        return {
            "success": True, 
            "message": f"File '{safe_filename}' deleted successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting file: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete file")

@app.get("/uploaded_files")
async def get_uploaded_files(session_id: str):
    """List uploaded files and web links for a given session with metadata."""
    try:
        if not session_id or not session_id.strip():
            raise HTTPException(status_code=400, detail="Invalid session ID")

        doc_dir = os.path.join(UPLOAD_DIR, session_id)
        if not os.path.exists(doc_dir):
            return {"files": []}
        
        # Load file metadata
        metadata_path = os.path.join(MEMORY_DIR, f"{session_id}_files.json")
        file_metadata = {}
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, "r") as f:
                    file_metadata = json.load(f)
            except Exception as e:
                logger.error(f"Error loading file metadata: {e}")

        files = []
        
        # First pass: collect all non-OCR files and note OCR status
        for entry in os.scandir(doc_dir):
            if entry.is_file():
                # Skip OCR-generated files (*.ocr.txt)
                if entry.name.endswith('.ocr.txt'):
                    continue
                    
                try:
                    file_stat = entry.stat()
                    base_name = entry.name
                    
                    # Check if this file has metadata (web scraped content)
                    file_info = file_metadata.get(base_name, {})
                    
                    # Create file entry
                    file_entry = {
                        "name": base_name,
                        "display_name": file_info.get("original_url", base_name),
                        "original_url": file_info.get("original_url", None),
                        "type": file_info.get("type", "file"),
                        "size": file_stat.st_size,
                        "human_size": human_readable_size(file_stat.st_size),
                        "modified": file_stat.st_mtime,
                        "modified_iso": datetime.fromtimestamp(file_stat.st_mtime).isoformat(),
                        "extension": os.path.splitext(base_name)[1].lower(),
                        "is_image": is_image_file(base_name),
                        "ocr_processed": False  # Will check below
                    }
                    
                    # Check if OCR file exists for this file
                    if file_entry["is_image"] or base_name.lower().endswith('.pdf'):
                        ocr_file = os.path.join(doc_dir, f"{base_name}.ocr.txt")
                        file_entry["ocr_processed"] = os.path.exists(ocr_file)
                    
                    files.append(file_entry)
                except Exception as e:
                    logger.warning(f"Error processing {entry.name}: {e}")
                    files.append({
                        "name": entry.name,
                        "display_name": entry.name,
                        "error": str(e)
                    })

        # Sort files by modification time (newest first)
        files.sort(key=lambda x: x.get("modified", 0), reverse=True)
        
        return {"files": files}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing files: {e}")
        raise HTTPException(status_code=500, detail="Failed to list files")

# Helper functions (add outside endpoint)
def human_readable_size(size_bytes):
    """Convert bytes to human-readable format"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"

def is_image_file(filename):
    """Check if file is an image"""
    image_exts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']
    return os.path.splitext(filename)[1].lower() in image_exts

@app.get("/health")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "healthy", "message": "FastAPI server is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)