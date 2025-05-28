import logging
from langchain_community.document_loaders import DirectoryLoader, UnstructuredFileLoader
from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser
from langchain_groq import ChatGroq
import os
from dotenv import load_dotenv

load_dotenv()

# Set up logger
logger = logging.getLogger(__name__)

groq_api_key = os.getenv("GROQ_API_KEY")

UPLOAD_DIR = "uploaded_docs"

def build_chain(session_id):
    # Define the directory where uploaded files are stored for this session
    doc_dir = os.path.join(UPLOAD_DIR, session_id)
    
    # Check if documents exist for this session
    if not os.path.exists(doc_dir) or not any(os.scandir(doc_dir)):
        logger.info(f"No documents found for session {session_id}, using general knowledge mode")
        return create_general_knowledge_chain()
    
    # Load documents from the directory
    loader = DirectoryLoader(doc_dir)
    documents = loader.load()
    
    # Split documents into chunks
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    splits = text_splitter.split_documents(documents)
    
    # Create embeddings and vector store
    embedding_model = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    vectorstore = FAISS.from_documents(documents=splits, embedding=embedding_model)
    
    # Create a retriever
    retriever = vectorstore.as_retriever()
    
    # Define a function to extract the question string from the input
    def get_query(inputs):
        if isinstance(inputs, dict) and "question" in inputs:
            return inputs["question"]
        elif isinstance(inputs, str):
            return inputs
        return str(inputs)
    
    # Define the prompt template
    template = """
You are a smart, friendly, and helpful personal assistant. Your task is to chat with the user naturally and answer their questions.
1. DOCUMENT-BASED ANSWERING: When documents are available, use them to provide accurate answers
2. GENERAL KNOWLEDGE: When no documents are available or they aren't relevant, use your general knowledge
3. CONVERSATIONAL ABILITIES: Engage in friendly conversation, respond to greetings, and handle small talk
4. NAME RECOGNITION: When a user introduces themselves, acknowledge their name and use it appropriately
5. DOCUMENT EXPLANATION: When asked to explain or summarize documents, provide a comprehensive overview

Chat History:
{chat_history}
    
Context:
{context}
    
Question: {question}
"""
    
    prompt = ChatPromptTemplate.from_template(template)
    
    # Create the model
    model = ChatGroq(model="gemma2-9b-it", api_key=groq_api_key)
    
    # Define a function to format the context from retrieved documents
    def format_docs(docs):
        return "\n\n".join(doc.page_content for doc in docs)
    
    # Create the RAG chain
    rag_chain = (
        {
            "context": lambda inputs: format_docs(retriever.invoke(get_query(inputs))),
            "question": lambda inputs: inputs["question"] if isinstance(inputs, dict) else str(inputs),
            "chat_history": lambda inputs: inputs.get("chat_history", "") if isinstance(inputs, dict) else ""
        }
        | prompt
        | model
        | StrOutputParser()
    )
    
    return rag_chain

def create_general_knowledge_chain():
    """Create a chain that uses only general knowledge without document context"""
    template = """
You are a smart, friendly, and helpful personal assistant. Your task is to chat with the user naturally and answer their questions using your general knowledge since no documents were provided.

Chat History:
{chat_history}
    
Question: {question}
"""
    
    prompt = ChatPromptTemplate.from_template(template)
    model = ChatGroq(model="gemma2-9b-it", api_key=groq_api_key)
    
    general_chain = (
        {
            "question": lambda inputs: inputs["question"] if isinstance(inputs, dict) else str(inputs),
            "chat_history": lambda inputs: inputs.get("chat_history", "") if isinstance(inputs, dict) else ""
        }
        | prompt
        | model
        | StrOutputParser()
    )
    
    return general_chain