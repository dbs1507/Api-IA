// Serviço para gerenciar o histórico de conversas
// Salvar como: services/conversation.js

import { ObjectId } from 'mongodb';
import { getDb } from '../services/db.js';

class ConversationService {
  // Armazenar mensagem na conversa do usuário
  static async storeMessage(userId, role, content) {
    try {
      const db = await getDb("plenna_db");
      const conversationsCollection = db.collection("Conversations");
      
      // Converter userId para ObjectId se for string
      const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
      
      await conversationsCollection.insertOne({
        userId: userObjectId,
        role: role, // 'user' ou 'assistant'
        content: content,
        timestamp: new Date()
      });
      
      return true;
    } catch (error) {
      console.error('Erro ao armazenar mensagem de conversa:', error);
      return false;
    }
  }
  
  // Obter histórico recente da conversa para contextualizar a IA
  static async getRecentConversation(userId, limit = 10) {
    try {
      const db = await getDb("plenna_db");
      const conversationsCollection = db.collection("Conversations");
      
      // Converter userId para ObjectId se for string
      const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
      
      // Buscar as mensagens mais recentes da conversa
      const messages = await conversationsCollection.find({
        userId: userObjectId
      })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
      
      // Reorganizar em ordem cronológica
      messages.reverse();
      
      // Formatar para o formato esperado pela OpenAI
      return messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
    } catch (error) {
      console.error('Erro ao buscar conversa recente:', error);
      return [];
    }
  }
}

export default ConversationService;