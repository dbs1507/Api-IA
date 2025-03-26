import dotenv from "dotenv";
import { ObjectId } from "mongodb";
import OpenAI from 'openai';
import { getDb } from "./db.js";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.GPT_API_KEY,
});

// Categorias padrão para novos usuários
const DEFAULT_CATEGORIES = [
  'Alimentação',
  'Transporte',
  'Moradia',
  'Saúde',
  'Educação',
  'Lazer',
  'Vestuário',
  'Outros'
];

/**
 * Detecta intenção de despesa a partir do texto da mensagem
 * @param {string} messageText - Texto da mensagem 
 * @returns {Object} Objeto com informações sobre a despesa detectada
 */
async function detectExpenseIntent(messageText) {
  try {
    // Tentar detectar padrões simples primeiro com expressões regulares
    const simplePatterns = [
      /^(\d+[,.]?\d*)\s+(.+)$/i,  // "50 uber", "50.5 cinema"
      /^(.+)\s+(\d+[,.]?\d*)$/i,   // "uber 50", "cinema 50.5"
      /^(?:gastei|paguei|comprei|despesa)(?:\s+(?:de|com|para))?\s+(?:R\$\s*)?(\d+[,.]?\d*)(?:\s+(?:em|com|para|por|no|na))?\s+(.+)$/i  // "Gastei R$ 50 no mercado"
    ];
    
    for (const pattern of simplePatterns) {
      const match = messageText.match(pattern);
      if (match) {
        let amount, description;
        
        // Determinar qual grupo é o valor e qual é a descrição
        const firstGroup = match[1]?.trim();
        const secondGroup = match[2]?.trim();
        
        // Se o primeiro grupo parece ser um número, então é [valor descrição]
        if (firstGroup && !isNaN(firstGroup.replace(',', '.'))) {
          amount = parseFloat(firstGroup.replace(',', '.'));
          description = secondGroup;
        } else {
          // Senão, é [descrição valor]
          description = firstGroup;
          amount = secondGroup ? parseFloat(secondGroup.replace(',', '.')) : null;
        }
        
        // Se conseguimos extrair um valor e descrição válidos
        if (!isNaN(amount) && description && description.length > 0) {
          console.log(`Padrão simples detectado: ${description} - ${amount}`);
          return {
            isExpense: true,
            description,
            amount,
            date: null
          };
        }
      }
    }
    
    // Se não identificou com regex, usar GPT para análise mais complexa
    const systemPrompt = `
      Você é um assistente especializado em detectar e extrair informações sobre despesas de mensagens.
      Dado o texto, verifique se o usuário está querendo registrar uma despesa.
      
      Considere como despesa mensagens com os seguintes padrões:
      - Mensagens com valor numérico e uma descrição
      - Menções a compra, pagamento, gasto ou similar
      - Formatos como "50 uber", "almoço 25", "cinema ontem 30"
      
      Se for uma despesa, extraia:
      1. A descrição da despesa (seja específico)
      2. O valor da despesa (em reais, apenas o número)
      3. A data (se mencionada, caso contrário null)
      
      Responda em JSON:
      {
        "isExpense": true/false,
        "description": "descrição da despesa",
        "amount": valor numérico,
        "date": "YYYY-MM-DD" (ou null)
      }
      
      IMPORTANTE: Priorize detectar despesas mesmo em formatos simples e diretos.
    `;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: messageText }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    
    const response = JSON.parse(completion.choices[0].message.content);
    console.log('Detecção de despesa via GPT:', response);
    
    // Verificação adicional para garantir dados completos
    if (response.isExpense) {
      if (!response.description || response.description.trim() === '' || 
          response.amount === undefined || response.amount === null) {
        console.log('Despesa detectada com dados incompletos, marcando como não despesa');
        response.isExpense = false;
      }
    }
    
    return response;
  } catch (error) {
    console.error('Erro ao detectar intenção de despesa:', error);
    return { isExpense: false };
  }
}

/**
 * Categoriza uma despesa usando IA
 * @param {string} description - Descrição da despesa
 * @param {ObjectId} userId - ID do usuário
 * @returns {Object} Objeto representando a categoria
 */
async function categorizeExpense(description, userId) {
  try {
    // Validação dos parâmetros
    if (!description || !userId) {
      console.error('Parâmetros inválidos para categorizeExpense:', { description, userId });
      throw new Error('Descrição e ID do usuário são obrigatórios');
    }
    
    const db = await getDb("plenna_db");
    const categoriesCollection = db.collection("Categories");
    
    // Converter userId para ObjectId se for string
    const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
    
    // Buscar categorias do usuário
    let userCategories = await categoriesCollection.find({ userId: userObjectId }).toArray();
    
    // Criar categorias padrão se necessário
    if (!userCategories || userCategories.length === 0) {
      userCategories = await createDefaultCategories(userObjectId);
    }
    
    // Fallback se ainda não tiver categorias
    if (!userCategories || userCategories.length === 0) {
      const result = await categoriesCollection.insertOne({
        name: 'Outros',
        userId: userObjectId,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      return {
        _id: result.insertedId,
        name: 'Outros',
        userId: userObjectId
      };
    }
    
    const categoryNames = userCategories.map(cat => cat.name);
    
    // Consulta otimizada à API para categorização
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Você é um assistente financeiro especializado em categorizar despesas.
                   Categorize a despesa em uma das seguintes categorias: ${categoryNames.join(', ')}.
                   Responda apenas com o nome exato da categoria, sem texto adicional.`
        },
        {
          role: "user",
          content: `Categorize esta despesa: "${description}"`
        }
      ],
      temperature: 0.3,
      max_tokens: 20 // Reduzido para eficiência
    });
    
    // Extrai a categoria sugerida e normaliza
    const suggestedCategoryName = response.choices[0].message.content.trim();
    
    // Busca caso exato ou aproximado na coleção
    let category = userCategories.find(
      cat => cat.name.toLowerCase() === suggestedCategoryName.toLowerCase()
    );
    
    // Se não encontrou, busca por aproximação
    if (!category) {
      category = userCategories.find(
        cat => suggestedCategoryName.toLowerCase().includes(cat.name.toLowerCase()) ||
               cat.name.toLowerCase().includes(suggestedCategoryName.toLowerCase())
      );
      
      // Cria nova categoria se necessário
      if (!category) {
        const result = await categoriesCollection.insertOne({
          name: suggestedCategoryName,
          userId: userObjectId,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        
        category = {
          _id: result.insertedId,
          name: suggestedCategoryName,
          userId: userObjectId
        };
        
        console.log(`Nova categoria criada: ${suggestedCategoryName}`);
      }
    }
    
    return category;
  } catch (error) {
    console.error('Erro ao categorizar despesa:', error);
    
    // Fallback para categoria "Outros"
    try {
      const db = await getDb("plenna_db");
      const categoriesCollection = db.collection("Categories");
      const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
      
      // Busca categoria "Outros"
      const fallbackCategory = await categoriesCollection.findOne({ 
        userId: userObjectId,
        name: 'Outros'
      });
      
      if (fallbackCategory) return fallbackCategory;
      
      // Cria categoria "Outros" se não existir
      const result = await categoriesCollection.insertOne({
        name: 'Outros',
        userId: userObjectId,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      return {
        _id: result.insertedId,
        name: 'Outros',
        userId: userObjectId
      };
    } catch (fallbackError) {
      console.error('Erro no fallback de categorização:', fallbackError);
      
      // Último recurso: retornar objeto em memória
      return {
        _id: new ObjectId(),
        name: 'Outros',
        userId: userObjectId
      };
    }
  }
}

/**
 * Cria categorias padrão para um novo usuário
 * @param {ObjectId} userId - ID do usuário
 * @returns {Array} Lista de categorias criadas
 */
async function createDefaultCategories(userId) {
  try {
    const db = await getDb("plenna_db");
    const categoriesCollection = db.collection("Categories");
    
    // Verificar se já existem categorias para o usuário
    const existingCategories = await categoriesCollection.countDocuments({ userId });
    if (existingCategories > 0) {
      return await categoriesCollection.find({ userId }).toArray();
    }
    
    // Criar categorias em uma única operação de banco
    const categoriesToInsert = DEFAULT_CATEGORIES.map(name => ({
      name,
      userId,
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    
    await categoriesCollection.insertMany(categoriesToInsert);
    console.log(`Categorias padrão criadas para o usuário ${userId}`);
    
    return await categoriesCollection.find({ userId }).toArray();
  } catch (error) {
    console.error('Erro ao criar categorias padrão:', error);
    return [];
  }
}

/**
 * Gera resposta contextual baseada na mensagem e histórico do usuário
 * @param {string} messageText - Texto da mensagem
 * @param {Object} contextData - Dados para contextualizar a resposta
 * @returns {string} Resposta gerada
 */
async function generateResponse(messageText, contextData = {}) {
  try {
    const { user, registeredExpense, recentExpenses = [] } = contextData;
    
    // Preparar contexto específico para despesa recém-registrada
    let expenseContext = "";
    if (registeredExpense && registeredExpense.category) {
      expenseContext = `
        O usuário acabou de registrar uma nova despesa:
        - Descrição: ${registeredExpense.description}
        - Valor: R$ ${registeredExpense.amount.toFixed(2)}
        - Categoria: ${registeredExpense.category.name}
        - Data: ${registeredExpense.date.toLocaleDateString('pt-BR')}
        
        Confirme o registro da despesa e ofereça insights relevantes.
      `;
    }
    
    // Contexto de despesas recentes
    let recentExpensesContext = "";
    if (recentExpenses && recentExpenses.length > 0) {
      recentExpensesContext = "\nDespesas recentes do usuário:\n";
      
      for (const exp of recentExpenses) {
        if (exp && exp.description && exp.amount && exp.category) {
          recentExpensesContext += `- ${exp.description}: R$ ${exp.amount.toFixed(2)} (${exp.category.name}) - ${exp.date.toLocaleDateString('pt-BR')}\n`;
        }
      }
    }
    
    // Prompt otimizado para o assistente financeiro
    const systemPrompt = `
      ## Contexto Geral
      Você é um assistente financeiro chamado **Plenna**, que ajuda usuários a organizar suas finanças pelo **WhatsApp**, sem planilhas ou apps complexos.
      Seu objetivo é **simplificar o controle de despesas e orçamentos**, fornecendo insights personalizados.
      Seu tom deve ser **amigável, acessível e motivador**, evitando jargões técnicos.
      
      ## Regras Gerais
      - Incentive o usuário a refletir sobre seus gastos
      - Sempre **explique as funcionalidades de forma simples**
      - Mantenha respostas **concisas e diretas** - máximo 3 parágrafos
      - Responda em português brasileiro, conversacional como no WhatsApp
      
      ## Sobre o Usuário
      Nome: ${user?.name || 'Usuário'}
      
      ${expenseContext}
      ${recentExpensesContext}
    `;
    
    // Fazer chamada otimizada à API
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: messageText }
      ],
      max_tokens: 400,
      temperature: 0.7,
    });
    
    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Erro ao gerar resposta contextual:', error);
    return "Desculpe, estou com um pequeno problema para processar sua mensagem. Pode tentar novamente?";
  }
}

// Adicione isso ao arquivo openIA.js

/**
 * Detecta intenção relacionada a categorias a partir do texto da mensagem
 * @param {string} messageText - Texto da mensagem 
 * @returns {Object} Objeto com informações sobre a intenção detectada
 */
async function detectCategoryIntent(messageText) {
  try {
    // Normalizar o texto para facilitar a detecção
    const normalizedText = messageText.toLowerCase().trim();
    
    // Padrões para detectar listagem de categorias
    const listPatterns = [
      /minhas categorias/i,
      /listar categorias/i,
      /mostrar categorias/i,
      /quais categorias/i,
      /ver categorias/i
    ];
    
    // Verificar se é uma solicitação para listar categorias
    for (const pattern of listPatterns) {
      if (pattern.test(normalizedText)) {
        return {
          isCategoryIntent: true,
          action: 'list',
          categoryName: null
        };
      }
    }
    
    // Padrões para criar nova categoria
    const createPatterns = [
      /criar categoria (.+)/i,
      /nova categoria (.+)/i,
      /adicionar categoria (.+)/i,
      /cadastrar categoria (.+)/i,
      /incluir categoria (.+)/i
    ];
    
    // Verificar se é uma solicitação para criar categoria
    for (const pattern of createPatterns) {
      const match = normalizedText.match(pattern);
      if (match && match[1]) {
        const categoryName = match[1].trim();
        if (categoryName.length > 0) {
          return {
            isCategoryIntent: true,
            action: 'create',
            categoryName: categoryName.charAt(0).toUpperCase() + categoryName.slice(1)
          };
        }
      }
    }
    
    // Verificar padrão "categoria nome_da_categoria"
    const simplePattern = /^categoria\s+(.+)$/i;
    const simpleMatch = normalizedText.match(simplePattern);
    if (simpleMatch && simpleMatch[1]) {
      const categoryName = simpleMatch[1].trim();
      if (categoryName.length > 0) {
        return {
          isCategoryIntent: true,
          action: 'create',
          categoryName: categoryName.charAt(0).toUpperCase() + categoryName.slice(1)
        };
      }
    }
    
    // Se não identificou com regex, usar GPT para análise mais complexa
    const systemPrompt = `
      Você é um assistente especializado em detectar e extrair informações sobre categorias financeiras.
      Dado o texto, verifique se o usuário está querendo listar suas categorias ou criar uma nova categoria.
      
      Considere intenções como:
      - "Me mostra minhas categorias" (listar)
      - "Quero criar uma categoria Viagens" (criar)
      - "Adiciona categoria Presentes" (criar)
      
      Responda em JSON:
      {
        "isCategoryIntent": true/false,
        "action": "list" ou "create",
        "categoryName": "nome da categoria" (apenas se action for "create", senão null)
      }
      
      IMPORTANTE: Seja conservador. Se não tiver certeza que é uma intenção relacionada a categorias, retorne isCategoryIntent: false.
    `;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: messageText }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    
    const response = JSON.parse(completion.choices[0].message.content);
    console.log('Detecção de intenção categoria via GPT:', response);
    
    // Verificação adicional para qualidade dos dados
    if (response.isCategoryIntent && response.action === 'create') {
      if (!response.categoryName || response.categoryName.trim() === '') {
        console.log('Intenção de criar categoria detectada sem nome válido');
        response.isCategoryIntent = false;
      }
    }
    
    return response;
  } catch (error) {
    console.error('Erro ao detectar intenção de categoria:', error);
    return { isCategoryIntent: false };
  }
}

/**
 * Cria uma nova categoria para o usuário
 * @param {string} categoryName - Nome da categoria a ser criada
 * @param {ObjectId} userId - ID do usuário
 * @returns {Object} A categoria criada
 */
async function createCategory(categoryName, userId) {
  try {
    // Validação dos parâmetros
    if (!categoryName || !userId) {
      console.error('Parâmetros inválidos para createCategory:', { categoryName, userId });
      throw new Error('Nome da categoria e ID do usuário são obrigatórios');
    }
    
    const db = await getDb("plenna_db");
    const categoriesCollection = db.collection("Categories");
    
    // Converter userId para ObjectId se for string
    const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
    
    // Verificar se a categoria já existe para este usuário
    const existingCategory = await categoriesCollection.findOne({ 
      userId: userObjectId,
      name: { $regex: new RegExp(`^${categoryName}$`, 'i') } // Case insensitive
    });
    
    if (existingCategory) {
      console.log(`Categoria "${categoryName}" já existe para o usuário ${userObjectId}`);
      return existingCategory;
    }
    
    // Criar nova categoria com primeira letra maiúscula
    const formattedName = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
    
    const result = await categoriesCollection.insertOne({
      name: formattedName,
      userId: userObjectId,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    const newCategory = {
      _id: result.insertedId,
      name: formattedName,
      userId: userObjectId,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log(`Nova categoria "${formattedName}" criada para o usuário ${userObjectId}`);
    return newCategory;
  } catch (error) {
    console.error('Erro ao criar categoria:', error);
    throw error;
  }
}

/**
 * Lista todas as categorias do usuário
 * @param {ObjectId} userId - ID do usuário
 * @returns {Array} Lista de categorias do usuário
 */
async function listCategories(userId) {
  try {
    // Validação dos parâmetros
    if (!userId) {
      console.error('ID do usuário não fornecido para listCategories');
      throw new Error('ID do usuário é obrigatório');
    }
    
    const db = await getDb("plenna_db");
    const categoriesCollection = db.collection("Categories");
    
    // Converter userId para ObjectId se for string
    const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
    
    // Buscar categorias do usuário
    let userCategories = await categoriesCollection.find({ userId: userObjectId })
      .sort({ name: 1 }) // Ordenar alfabeticamente
      .toArray();
    
    // Criar categorias padrão se necessário
    if (!userCategories || userCategories.length === 0) {
      userCategories = await createDefaultCategories(userObjectId);
    }
    
    return userCategories;
  } catch (error) {
    console.error('Erro ao listar categorias:', error);
    throw error;
  }
}

/**
 * Detecta intenção relacionada a orçamentos a partir do texto da mensagem
 * @param {string} messageText - Texto da mensagem 
 * @returns {Object} Objeto com informações sobre a intenção detectada
 */
async function detectBudgetIntent(messageText) {
  try {
    // Normalizar o texto para facilitar a detecção
    const normalizedText = messageText.toLowerCase().trim();
    
    console.log(`Detectando intenção de orçamento para: "${normalizedText}"`);
    
    // Padrão simples - "orçamento categoria valor"
    // Esta é a forma mais direta e comum para criar orçamentos
    const simplePattern = /(?:orçamento|orcamento)\s+(\w+)\s+(\d+[.,]?\d*)/i;
    const simpleMatch = normalizedText.match(simplePattern);
    
    if (simpleMatch && simpleMatch[1] && simpleMatch[2]) {
      const categoryName = simpleMatch[1].trim();
      const amount = parseFloat(simpleMatch[2].replace(',', '.'));
      
      console.log(`Detectado padrão de criação de orçamento: categoria='${categoryName}', valor=${amount}`);
      
      if (categoryName.length > 0 && !isNaN(amount) && amount > 0) {
        return {
          isBudgetIntent: true,
          action: 'create',
          categoryName: categoryName.charAt(0).toUpperCase() + categoryName.slice(1),
          amount
        };
      }
    }
    
    // Padrão para apenas a palavra "orçamento"
    if (normalizedText === 'orçamento' || normalizedText === 'orcamento' || 
        normalizedText === 'orçamentos' || normalizedText === 'orcamentos') {
      console.log("Detectada menção geral a orçamentos");
      return {
        isBudgetIntent: true,
        action: 'info',
        categoryName: null,
        amount: null
      };
    }
    
    // Verificar outras menções a orçamentos
    if (normalizedText.includes('orçamento') || normalizedText.includes('orcamento')) {
      console.log("Menção a orçamento detectada, mas sem padrão específico");
      return {
        isBudgetIntent: true,
        action: 'info',
        categoryName: null,
        amount: null
      };
    }
    
    return { isBudgetIntent: false };
  } catch (error) {
    console.error('Erro ao detectar intenção de orçamento:', error);
    console.error('Stack trace:', error.stack);
    return { isBudgetIntent: false };
  }
}

// Adicione à lista de exports
export {
  categorizeExpense, createCategory, createDefaultCategories,
  DEFAULT_CATEGORIES, detectBudgetIntent, detectCategoryIntent, detectExpenseIntent,
  generateResponse, listCategories
};

