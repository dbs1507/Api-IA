import express from "express";
import WhatsApp from "../controllers/whatsapp.controller.js";
import router from "../routes/routes.js";
import SSE from "./SSE.js";

const app = express();
app.use(express.json());
app.use(router);

// Inicializa a conexão SSE automaticamente ao iniciar o servidor
console.log("Iniciando conexão SSE automaticamente...");
SSE.connect();

// Configura o listener de mensagens do WhatsApp
SSE.onMessage(async (sseData) => {
  console.log('SSE message received:', sseData);
  
  // Verifica se é uma mensagem do formato esperado
  if (sseData.EventType === 'messages' && sseData.message) {
    const message = sseData.message;
    
    // Verifica se é uma mensagem de texto e não foi enviada pelo próprio bot
    if ((message.messageType === 'Conversation' || message.type === 'text') && !message.fromMe) {
      console.log('Nova mensagem de WhatsApp recebida:', message);
      
      try {
        // Extrai informações da mensagem
        const senderNumber = message.sender ? message.sender.split('@')[0] : message.chatid.split('@')[0];
        const messageText = message.text;
        const messageId = message.messageid || message.id;
        
        console.log(`Processando mensagem de ${senderNumber}: "${messageText}"`);

        // Processa a mensagem, incluindo detecção de despesa e registro no banco
        await WhatsApp.replyToMessage(senderNumber, messageText, messageId);
      } catch (error) {
        console.error('Erro ao processar mensagem do WhatsApp:', error);
        
        // Envia mensagem de fallback em caso de erro
        try {
          const senderNumber = message.sender ? message.sender.split('@')[0] : message.chatid.split('@')[0];
          const messageId = message.messageid || message.id;
          
          await WhatsApp.sendFallbackMessage(senderNumber, messageId);
        } catch (fallbackError) {
          console.error('Erro no fallback:', fallbackError);
        }
      }
    }
  }
});

app.listen(3003, () => {
  console.log("Server running on port 3003");
  console.log("SSE connection established - Webhook ready to receive messages");
});