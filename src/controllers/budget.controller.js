import { ObjectId } from "mongodb";
import { getDb } from "../services/db.js";

export default class BudgetController {
  /**
   * Cria ou atualiza um orçamento para uma categoria
   * @param {Object} budgetData - Dados do orçamento
   * @returns {Object} Orçamento criado ou atualizado
   */
  static async createOrUpdateBudget(budgetData) {
    try {
      // Validar dados obrigatórios
      if (!budgetData || !budgetData.userId || !budgetData.categoryId || !budgetData.amount) {
        throw new Error('Dados incompletos: userId, categoryId e amount são obrigatórios');
      }
      
      const db = await getDb("plenna_db");
      const budgetsCollection = db.collection("Budgets");
      
      // Converter para ObjectId se necessário
      const userObjectId = typeof budgetData.userId === 'string' 
        ? new ObjectId(budgetData.userId) 
        : budgetData.userId;
        
      const categoryObjectId = typeof budgetData.categoryId === 'string' 
        ? new ObjectId(budgetData.categoryId) 
        : budgetData.categoryId;
      
      // Obter mês e ano atuais se não fornecidos
      const currentDate = new Date();
      const month = budgetData.month || currentDate.getMonth() + 1;
      const year = budgetData.year || currentDate.getFullYear();
      
      console.log(`Tentando criar/atualizar orçamento: userId=${userObjectId}, categoryId=${categoryObjectId}, valor=${budgetData.amount}, mês=${month}, ano=${year}`);
      
      // Verificar se já existe orçamento para esta categoria
      const existingBudget = await budgetsCollection.findOne({
        userId: userObjectId,
        categoryId: categoryObjectId,
        month: month,
        year: year
      });
      
      // Buscar a categoria para incluir na resposta
      const categoriesCollection = db.collection("Categories");
      const category = await categoriesCollection.findOne({ _id: categoryObjectId });
      
      if (!category) {
        throw new Error(`Categoria com ID ${categoryObjectId} não encontrada`);
      }
      
      if (existingBudget) {
        // Atualizar orçamento existente
        const oldAmount = existingBudget.amount;
        
        const updateResult = await budgetsCollection.updateOne(
          { _id: existingBudget._id },
          { 
            $set: { 
              amount: budgetData.amount,
              updatedAt: new Date()
            } 
          }
        );
        
        if (updateResult.modifiedCount > 0) {
          console.log(`Orçamento atualizado: ${existingBudget._id}, valor anterior: ${oldAmount}, novo valor: ${budgetData.amount}`);
          
          return {
            ...existingBudget,
            amount: budgetData.amount,
            previousAmount: oldAmount,
            isUpdate: true,
            category: category
          };
        }
        
        console.log(`Nenhuma alteração feita no orçamento ${existingBudget._id}`);
        return { ...existingBudget, isUpdate: false, category: category };
      } else {
        // Criar novo orçamento
        const newBudget = {
          userId: userObjectId,
          categoryId: categoryObjectId,
          amount: budgetData.amount,
          month: month,
          year: year,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        const result = await budgetsCollection.insertOne(newBudget);
        console.log(`Novo orçamento criado: ${result.insertedId}, valor: ${budgetData.amount}`);
        
        return {
          _id: result.insertedId,
          ...newBudget,
          isNew: true,
          category: category
        };
      }
    } catch (error) {
      console.error('Erro ao criar/atualizar orçamento:', error);
      throw error;
    }
  }

  /**
   * Lista todos os orçamentos do usuário
   * @param {ObjectId} userId - ID do usuário
   * @param {Object} options - Opções de filtro (mês, ano)
   * @returns {Array} Lista de orçamentos
   */
  static async getUserBudgets(userId, options = {}) {
    try {
      if (!userId) {
        throw new Error('ID do usuário é obrigatório');
      }
      
      const db = await getDb("plenna_db");
      const budgetsCollection = db.collection("Budgets");
      
      // Converter userId para ObjectId se necessário
      const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
      
      // Obter mês e ano atuais se não fornecidos
      const currentDate = new Date();
      const month = options.month || currentDate.getMonth() + 1;
      const year = options.year || currentDate.getFullYear();
      
      // Log detalhado para debug
      console.log(`Buscando orçamentos para: userId=${userObjectId.toString()}, mês=${month}, ano=${year}`);
      
      // Construir filtro
      const filter = { 
        userId: userObjectId,
        month: month,
        year: year
      };
      
      // Registrar o filtro para debug
      console.log('Filtro de busca:', JSON.stringify(filter));
      
      // Buscar orçamentos - com verificação no banco de dados
      const collectionExists = await db.listCollections({ name: "Budgets" }).hasNext();
      if (!collectionExists) {
        console.log("ATENÇÃO: Collection 'Budgets' não existe no banco de dados!");
        await db.createCollection("Budgets");
        return [];
      }
      
      // Tentar buscar todos os orçamentos para este usuário sem filtro de mês/ano primeiro
      // Isso ajuda a verificar se há algum orçamento deste usuário no banco
      const allBudgetsForUser = await budgetsCollection.find({ userId: userObjectId }).toArray();
      console.log(`Total de orçamentos para o usuário (qualquer mês/ano): ${allBudgetsForUser.length}`);
      
      // Agora buscar com o filtro completo
      const budgets = await budgetsCollection.find(filter).toArray();
      console.log(`Encontrados ${budgets.length} orçamentos para mês ${month}/${year}`);
      
      // Enriquecer dados com informações da categoria
      return await this.enrichBudgetsWithCategoryNames(budgets);
    } catch (error) {
      console.error('Erro ao buscar orçamentos do usuário:', error);
      console.error('Stack trace:', error.stack);
      // Fallback para resposta vazia
      return [];
    }
  }

  /**
   * Adiciona nomes das categorias aos orçamentos e calcula progresso
   * @param {Array} budgets - Lista de orçamentos
   * @returns {Array} Orçamentos com informações de categoria e progresso
   */
  static async enrichBudgetsWithCategoryNames(budgets) {
    try {
      if (!budgets || budgets.length === 0) {
        return [];
      }
      
      const db = await getDb("plenna_db");
      const categoriesCollection = db.collection("Categories");
      const expensesCollection = db.collection("Expenses");
      
      // Extrair IDs de categorias
      const categoryIds = budgets.map(budget => 
        typeof budget.categoryId === 'string' ? new ObjectId(budget.categoryId) : budget.categoryId
      );
      
      console.log(`Enriquecendo ${budgets.length} orçamentos com informações de categorias...`);
      
      // Buscar categorias em massa
      const categories = await categoriesCollection.find({
        _id: { $in: categoryIds }
      }).toArray();
      
      console.log(`Encontradas ${categories.length} categorias para os orçamentos`);
      
      // Criar mapa de ID -> categoria para lookup eficiente
      const categoryMap = {};
      categories.forEach(category => {
        categoryMap[category._id.toString()] = category;
      });
      
      // Processar cada orçamento individualmente
      const enrichedBudgets = await Promise.all(budgets.map(async (budget) => {
        try {
          // Garantir que categoryId é um ObjectId
          const categoryId = typeof budget.categoryId === 'string' 
            ? new ObjectId(budget.categoryId) 
            : budget.categoryId;
          
          const categoryIdStr = categoryId.toString();
          const userId = budget.userId;
          
          // Calcular período do orçamento
          const startDate = new Date(budget.year, budget.month - 1, 1);
          const endDate = new Date(budget.year, budget.month, 0, 23, 59, 59, 999);
          
          // Buscar despesas desta categoria no período
          const expenses = await expensesCollection.find({
            userId: userId,
            categoryId: categoryId,
            date: { $gte: startDate, $lte: endDate }
          }).toArray();
          
          console.log(`Encontradas ${expenses.length} despesas para orçamento ${budget._id} (categoria ${categoryIdStr})`);
          
          // Calcular total gasto
          const spent = expenses.reduce((total, expense) => total + expense.amount, 0);
          
          // Calcular percentual de uso
          const percentage = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
          
          return {
            ...budget,
            category: categoryMap[categoryIdStr] || { name: 'Categoria Desconhecida' },
            spent,
            percentage: parseFloat(percentage.toFixed(2)),
            remaining: Math.max(0, budget.amount - spent),
            isOverBudget: spent > budget.amount
          };
        } catch (err) {
          console.error(`Erro ao processar orçamento ${budget._id}:`, err);
          return {
            ...budget,
            category: { name: 'Categoria Desconhecida' },
            spent: 0,
            percentage: 0,
            remaining: budget.amount,
            isOverBudget: false,
            processingError: true
          };
        }
      }));
      
      return enrichedBudgets;
    } catch (error) {
      console.error('Erro ao enriquecer orçamentos com nomes de categorias:', error);
      console.error('Stack trace:', error.stack);
      return budgets; // Retornar orçamentos originais em caso de erro
    }
  }

  /**
   * Obtém o orçamento para uma categoria específica
   * @param {ObjectId} userId - ID do usuário
   * @param {ObjectId} categoryId - ID da categoria
   * @param {Object} options - Opções de filtro (mês, ano)
   * @returns {Object} Orçamento encontrado ou null
   */
  static async getBudgetByCategory(userId, categoryId, options = {}) {
    try {
      if (!userId || !categoryId) {
        throw new Error('ID do usuário e ID da categoria são obrigatórios');
      }
      
      const db = await getDb("plenna_db");
      const budgetsCollection = db.collection("Budgets");
      
      // Converter para ObjectId se necessário
      const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
      const categoryObjectId = typeof categoryId === 'string' ? new ObjectId(categoryId) : categoryId;
      
      // Obter mês e ano atuais se não fornecidos
      const currentDate = new Date();
      const month = options.month || currentDate.getMonth() + 1;
      const year = options.year || currentDate.getFullYear();
      
      // Log detalhado para debug
      console.log(`Buscando orçamento para: userId=${userObjectId.toString()}, categoryId=${categoryObjectId.toString()}, mês=${month}, ano=${year}`);
      
      // Verificar existência da collection
      const collectionExists = await db.listCollections({ name: "Budgets" }).hasNext();
      if (!collectionExists) {
        console.log("ATENÇÃO: Collection 'Budgets' não existe no banco de dados!");
        await db.createCollection("Budgets");
        return null;
      }
      
      // Construir filtro
      const filter = {
        userId: userObjectId,
        categoryId: categoryObjectId,
        month: month,
        year: year
      };
      
      // Registrar o filtro para debug
      console.log('Filtro de busca:', JSON.stringify(filter));
      
      // Buscar orçamento
      const budget = await budgetsCollection.findOne(filter);
      
      if (!budget) {
        console.log(`Nenhum orçamento encontrado para a categoria ${categoryObjectId.toString()}`);
        return null;
      }
      
      console.log(`Orçamento encontrado: ${budget._id}`);
      
      // Buscar categoria
      const categoriesCollection = db.collection("Categories");
      const category = await categoriesCollection.findOne({ _id: categoryObjectId });
      
      if (!category) {
        console.log(`Categoria ${categoryObjectId.toString()} não encontrada`);
      }
      
      // Calcular período do orçamento
      const startDate = new Date(budget.year, budget.month - 1, 1);
      const endDate = new Date(budget.year, budget.month, 0, 23, 59, 59, 999);
      
      // Buscar despesas desta categoria no período
      const expensesCollection = db.collection("Expenses");
      const expenses = await expensesCollection.find({
        userId: userObjectId,
        categoryId: categoryObjectId,
        date: { $gte: startDate, $lte: endDate }
      }).sort({ date: -1 }).toArray();
      
      console.log(`Encontradas ${expenses.length} despesas para este orçamento`);
      
      // Calcular total gasto
      const spent = expenses.reduce((total, expense) => total + expense.amount, 0);
      
      // Calcular percentual
      const percentage = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
      
      return {
        ...budget,
        category: category || { name: 'Categoria Desconhecida' },
        spent,
        percentage: parseFloat(percentage.toFixed(2)),
        remaining: Math.max(0, budget.amount - spent),
        isOverBudget: spent > budget.amount,
        recentExpenses: expenses.slice(0, 3) // Pegar as 3 despesas mais recentes
      };
    } catch (error) {
      console.error('Erro ao buscar orçamento por categoria:', error);
      console.error('Stack trace:', error.stack);
      return null;
    }
  }

  /**
   * Exclui um orçamento
   * @param {ObjectId} userId - ID do usuário
   * @param {ObjectId} categoryId - ID da categoria
   * @param {Object} options - Opções de filtro (mês, ano)
   * @returns {boolean} Sucesso da operação
   */
  static async deleteBudget(userId, categoryId, options = {}) {
    try {
      if (!userId || !categoryId) {
        throw new Error('ID do usuário e ID da categoria são obrigatórios');
      }
      
      const db = await getDb("plenna_db");
      const budgetsCollection = db.collection("Budgets");
      
      // Converter para ObjectId se necessário
      const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
      const categoryObjectId = typeof categoryId === 'string' ? new ObjectId(categoryId) : categoryId;
      
      // Obter mês e ano atuais se não fornecidos
      const currentDate = new Date();
      const month = options.month || currentDate.getMonth() + 1;
      const year = options.year || currentDate.getFullYear();
      
      // Log detalhado para debug
      console.log(`Excluindo orçamento: userId=${userObjectId.toString()}, categoryId=${categoryObjectId.toString()}, mês=${month}, ano=${year}`);
      
      // Construir filtro
      const filter = {
        userId: userObjectId,
        categoryId: categoryObjectId,
        month: month,
        year: year
      };
      
      // Buscar orçamento antes de excluir para retorno
      const budget = await budgetsCollection.findOne(filter);
      
      if (!budget) {
        console.log("Nenhum orçamento encontrado para exclusão");
        return { success: false, message: "Orçamento não encontrado" };
      }
      
      // Excluir orçamento
      const result = await budgetsCollection.deleteOne(filter);
      console.log(`Orçamento excluído: ${result.deletedCount} documento(s)`);
      
      if (result.deletedCount > 0) {
        // Buscar categoria para retorno
        const categoriesCollection = db.collection("Categories");
        const category = await categoriesCollection.findOne({ _id: categoryObjectId });
        
        return { 
          success: true, 
          message: "Orçamento excluído com sucesso",
          budget: {
            ...budget,
            category: category || { name: 'Categoria Desconhecida' }
          }
        };
      }
      
      return { success: false, message: "Não foi possível excluir o orçamento" };
    } catch (error) {
      console.error('Erro ao excluir orçamento:', error);
      console.error('Stack trace:', error.stack);
      throw error;
    }
  }
}