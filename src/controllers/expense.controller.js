import dotenv from "dotenv";
import { ObjectId } from "mongodb";
import { getDb } from "../services/db.js";
dotenv.config();

export default class ExpenseController {
  static async createExpense({ description, amount, userId, categoryId, date = new Date() }) {
    try {
      // Validação dos parâmetros obrigatórios
      if (!description || !amount || !userId || !categoryId) {
        console.error('Erro: Parâmetros inválidos para createExpense', { description, amount, userId, categoryId });
        throw new Error('Todos os campos são obrigatórios: description, amount, userId, categoryId');
      }
      
      const db = await getDb("plenna_db");
      const expensesCollection = db.collection("Expenses");
      
      // Convertendo os IDs para ObjectId se necessário
      const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
      const categoryObjectId = typeof categoryId === 'string' ? new ObjectId(categoryId) : categoryId;
      
      // Criando a despesa no MongoDB
      const result = await expensesCollection.insertOne({
        description,
        amount,
        date,
        userId: userObjectId,
        categoryId: categoryObjectId,
        createdAt: new Date()
      });
      
      // Buscando a categoria para incluir na resposta
      const categoriesCollection = db.collection("Categories");
      const category = await categoriesCollection.findOne({ _id: categoryObjectId });
      
      // Se não encontrar a categoria, usa um objeto com nome padrão
      const safeCategory = category || { name: "Categoria não encontrada" };
      
      const expense = {
        _id: result.insertedId,
        description,
        amount,
        date,
        userId: userObjectId,
        categoryId: categoryObjectId,
        category: safeCategory
      };
      
      console.log(`Nova despesa criada: ${expense._id} (${amount} - ${description})`);
      return expense;
    } catch (error) {
      console.error('Erro ao criar despesa:', error);
      throw error;
    }
  }

  static async getUserExpenses(userId, filters = {}) {
    const { startDate, endDate, categoryId, limit } = filters;
    
    try {
      // Validação do userId
      if (!userId) {
        console.error('Erro: userId é obrigatório');
        return [];
      }
      
      const db = await getDb("plenna_db");
      const expensesCollection = db.collection("Expenses");
      const categoriesCollection = db.collection("Categories");
      
      // Convertendo o userId para ObjectId se for uma string
      const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
      
      // Construindo a query
      const query = { userId: userObjectId };
      
      // Adiciona filtro de data, se fornecido
      if (startDate || endDate) {
        query.date = {};
        
        if (startDate) {
          query.date.$gte = new Date(startDate);
        }
        
        if (endDate) {
          query.date.$lte = new Date(endDate);
        }
      }
      
      // Adiciona filtro de categoria, se fornecido
      if (categoryId) {
        query.categoryId = typeof categoryId === 'string' ? new ObjectId(categoryId) : categoryId;
      }
      
      // Cria o cursor com ordenação
      let cursor = expensesCollection.find(query).sort({ date: -1 });
      
      // Aplica limite se fornecido
      if (limit && typeof limit === 'number') {
        cursor = cursor.limit(limit);
      }
      
      // Executando a consulta
      const expenses = await cursor.toArray();
      
      // Buscando as categorias para cada despesa, com tratamento de erro
      const expensesWithCategories = await Promise.all(
        expenses.map(async (expense) => {
          try {
            // Verificar se categoryId é válido antes de buscar
            if (!expense.categoryId) {
              return {
                ...expense,
                category: { name: "Categoria não especificada" }
              };
            }
            
            const category = await categoriesCollection.findOne({ _id: expense.categoryId });
            
            // Se a categoria não for encontrada, usar um objeto padrão
            return {
              ...expense,
              category: category || { name: "Categoria não encontrada" }
            };
          } catch (err) {
            console.error(`Erro ao buscar categoria para despesa ${expense._id}:`, err);
            return {
              ...expense,
              category: { name: "Erro ao carregar categoria" }
            };
          }
        })
      );
      
      return expensesWithCategories;
    } catch (error) {
      console.error(`Erro ao buscar despesas do usuário ${userId}:`, error);
      return []; // Retorna array vazio em caso de erro
    }
  }
  
  // Obtém o total de despesas por categoria
  static async getExpensesByCategory(userId, { startDate, endDate } = {}) {
    try {
      if (!userId) {
        console.error('Erro: userId é obrigatório');
        return { categories: [], total: 0 };
      }
      
      const db = await getDb("plenna_db");
      const expensesCollection = db.collection("Expenses");
      const categoriesCollection = db.collection("Categories");
      
      // Convertendo o userId para ObjectId se for uma string
      const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
      
      // Construindo a query
      const query = { userId: userObjectId };
      
      // Adiciona filtro de data, se fornecido
      if (startDate || endDate) {
        query.date = {};
        
        if (startDate) {
          query.date.$gte = new Date(startDate);
        }
        
        if (endDate) {
          query.date.$lte = new Date(endDate);
        }
      }
      
      // Buscar despesas
      const expenses = await expensesCollection.find(query).toArray();
      
      // Buscar todas as categorias do usuário
      const categories = await categoriesCollection.find({ userId: userObjectId }).toArray();
      
      // Mapear categorias por ID para acesso rápido
      const categoriesById = categories.reduce((acc, category) => {
        acc[category._id.toString()] = category;
        return acc;
      }, {});
      
      // Agrupar e calcular totais manualmente
      const totals = {};
      let grandTotal = 0;
      
      for (const expense of expenses) {
        if (!expense.categoryId) continue; // Pula se não tiver categoria
        
        const categoryId = expense.categoryId.toString();
        const category = categoriesById[categoryId];
        
        if (!category) continue; // Pula se a categoria não for encontrada
        
        const categoryName = category.name;
        
        if (!totals[categoryName]) {
          totals[categoryName] = {
            categoryId: expense.categoryId,
            name: categoryName,
            total: 0,
            count: 0
          };
        }
        
        totals[categoryName].total += expense.amount;
        totals[categoryName].count += 1;
        grandTotal += expense.amount;
      }
      
      // Converter para array e calcular percentagens
      const result = Object.values(totals).map(item => ({
        ...item,
        percentage: grandTotal > 0 ? (item.total / grandTotal) * 100 : 0
      }));
      
      // Ordenar por total (descendente)
      result.sort((a, b) => b.total - a.total);
      
      return { categories: result, total: grandTotal };
    } catch (error) {
      console.error(`Erro ao buscar despesas por categoria para o usuário ${userId}:`, error);
      return { categories: [], total: 0 }; // Retorna objeto padrão em caso de erro
    }
  }
}