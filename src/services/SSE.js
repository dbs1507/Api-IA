import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

class SSEService {
  constructor() {
    this.connection = null;
    this.messages = [];
    this.callbacks = [];
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) {
      this.disconnect();
    }

    const url = 'https://plenna.uazapi.com/sse';
    const token = process.env.AUTH_TOKEN;
    
    // Cria uma URL com o token como parâmetro de consulta
    const fullUrl = `${url}?token=${token}&events=messages`;
    
    try {
      console.log('Establishing SSE connection...');
      
      // Usando axios para streaming
      this.connection = axios({
        method: 'GET',
        url: fullUrl,
        responseType: 'stream',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache'
        }
      });

      const stream = (await this.connection).data;
      this.isConnected = true;
      console.log('SSE connection established');

      let buffer = '';
      
      stream.on('data', (chunk) => {
        const chunkStr = chunk.toString();
        buffer += chunkStr;
        
        // Processa linhas completas
        if (buffer.includes('\n\n')) {
          const parts = buffer.split('\n\n');
          // O último elemento pode estar incompleto
          buffer = parts.pop();
          
          for (const part of parts) {
            if (part.startsWith('data:')) {
              try {
                const dataStr = part.substring(5).trim();
                const data = JSON.parse(dataStr);
                console.log('SSE message received:', data);
                
                // Armazena a mensagem recebida
                this.messages.push(data);
                
                // Notifica todos os callbacks registrados
                this.callbacks.forEach(callback => callback(data));
              } catch (error) {
                console.error('Error parsing SSE message:', error);
              }
            }
          }
        }
      });
      
      stream.on('error', (error) => {
        console.error('SSE connection error:', error);
        this.disconnect();
        
        // Tenta reconectar após 5 segundos
        setTimeout(() => this.connect(), 5000);
      });
      
      stream.on('end', () => {
        console.log('SSE connection ended');
        this.disconnect();
        
        // Tenta reconectar após 5 segundos
        setTimeout(() => this.connect(), 5000);
      });
      
    } catch (error) {
      console.error('Error creating SSE connection:', error);
      this.isConnected = false;
      
      // Tenta reconectar após 5 segundos
      setTimeout(() => this.connect(), 5000);
    }
  }

  disconnect() {
    if (this.connection && this.connection.cancel) {
      this.connection.cancel();
    }
    this.isConnected = false;
    console.log('SSE connection closed');
  }

  // Método para obter as mensagens armazenadas
  getMessages() {
    return this.messages;
  }

  // Método para limpar as mensagens armazenadas
  clearMessages() {
    this.messages = [];
  }

  // Método para registrar um callback que será chamado quando uma nova mensagem for recebida
  onMessage(callback) {
    if (typeof callback === 'function') {
      this.callbacks.push(callback);
    }
  }

  // Método para remover um callback
  removeCallback(callback) {
    this.callbacks = this.callbacks.filter(cb => cb !== callback);
  }
}

// Exporta uma instância única do serviço
const SSE = new SSEService();
export default SSE;