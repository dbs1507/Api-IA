import { getDb } from "../services/db.js";
import { ObjectId } from "mongodb";

// Encontra ou cria um usuário pelo número de telefone
export async function findOrCreateUser(phoneNumber) {
  try {
    const db = await getDb("plenna_db");
    const usersCollection = db.collection("Users");
    
    // Buscar usuário pelo número de telefone
    const existingUser = await usersCollection.findOne({ phoneNumber });
    
    // Se o usuário já existe, retorná-lo
    if (existingUser) {
      console.log(`Usuário encontrado: ${existingUser._id} (${existingUser.name})`);
      return existingUser;
    }
    
    // Se não existe, criar um novo usuário
    const result = await usersCollection.insertOne({
      phoneNumber,
      name: `Usuário ${phoneNumber.slice(-4)}`,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    const newUser = {
      _id: result.insertedId,
      phoneNumber,
      name: `Usuário ${phoneNumber.slice(-4)}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log(`Novo usuário criado: ${newUser._id} (${newUser.name})`);
    return newUser;
  } catch (error) {
    console.error('Erro ao encontrar ou criar usuário:', error);
    throw error;
  }
}

// Atualiza o nome do usuário
export async function updateUserName(userId, newName) {
  try {
    const db = await getDb("plenna_db");
    const usersCollection = db.collection("Users");
    
    // Convertendo o userId para ObjectId se for uma string
    const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
    
    // Atualizar o nome do usuário
    const result = await usersCollection.updateOne(
      { _id: userObjectId },
      { 
        $set: { 
          name: newName,
          updatedAt: new Date()
        } 
      }
    );
    
    if (result.matchedCount === 0) {
      throw new Error(`Usuário com ID ${userId} não encontrado`);
    }
    
    // Buscar o usuário atualizado
    const updatedUser = await usersCollection.findOne({ _id: userObjectId });
    
    console.log(`Nome do usuário atualizado: ${updatedUser._id} (${updatedUser.name})`);
    return updatedUser;
  } catch (error) {
    console.error('Erro ao atualizar nome do usuário:', error);
    throw error;
  }
}

// Exportação padrão para compatibilidade
export default {
  findOrCreateUser,
  updateUserName
};