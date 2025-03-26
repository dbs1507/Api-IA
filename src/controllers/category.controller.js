// import { ObjectId } from "mongodb";
// import { getDb } from "../services/db.js";
// import { createDefaultCategories } from "../services/openIA.js";

// export default class CategoryController {
//     /**
//  * Detecta intenção relacionada a categorias a partir do texto da mensagem
//  * @param {string} messageText - Texto da mensagem 
//  * @returns {Object} Objeto com informações sobre a intenção detectada
//  */
//   static async detectCategoryIntent(messageText) {
//     try {
//       // Normalizar o texto para facilitar a detecção
//       const normalizedText = messageText.toLowerCase().trim();
      
//       // Padrões para detectar listagem de categorias
//       const listPatterns = [
//         /minhas categorias/i,
//         /listar categorias/i,
//         /mostrar categorias/i,
//         /quais categorias/i,
//         /ver categorias/i
//       ];
      
//       // Verificar se é uma solicitação para listar categorias
//       for (const pattern of listPatterns) {
//         if (pattern.test(normalizedText)) {
//           return {
//             isCategoryIntent: true,
//             action: 'list',
//             categoryName: null
//           };
//         }
//       }
      
//       // Padrões para criar nova categoria
//       const createPatterns = [
//         /criar categoria (.+)/i,
//         /nova categoria (.+)/i,
//         /adicionar categoria (.+)/i,
//         /cadastrar categoria (.+)/i,
//         /incluir categoria (.+)/i
//       ];
      
//       // Verificar se é uma solicitação para criar categoria
//       for (const pattern of createPatterns) {
//         const match = normalizedText.match(pattern);
//         if (match && match[1]) {
//           const categoryName = match[1].trim();
//           if (categoryName.length > 0) {
//             return {
//               isCategoryIntent: true,
//               action: 'create',
//               categoryName: categoryName.charAt(0).toUpperCase() + categoryName.slice(1)
//             };
//           }
//         }
//       }
      
//       // Verificar padrão "categoria nome_da_categoria"
//       const simplePattern = /^categoria\s+(.+)$/i;
//       const simpleMatch = normalizedText.match(simplePattern);
//       if (simpleMatch && simpleMatch[1]) {
//         const categoryName = simpleMatch[1].trim();
//         if (categoryName.length > 0) {
//           return {
//             isCategoryIntent: true,
//             action: 'create',
//             categoryName: categoryName.charAt(0).toUpperCase() + categoryName.slice(1)
//           };
//         }
//       }
      
//       // Se não identificou com regex, usar GPT para análise mais complexa
//       const systemPrompt = `
//         Você é um assistente especializado em detectar e extrair informações sobre categorias financeiras.
//         Dado o texto, verifique se o usuário está querendo listar suas categorias ou criar uma nova categoria.
        
//         Considere intenções como:
//         - "Me mostra minhas categorias" (listar)
//         - "Quero criar uma categoria Viagens" (criar)
//         - "Adiciona categoria Presentes" (criar)
        
//         Responda em JSON:
//         {
//           "isCategoryIntent": true/false,
//           "action": "list" ou "create",
//           "categoryName": "nome da categoria" (apenas se action for "create", senão null)
//         }
        
//         IMPORTANTE: Seja conservador. Se não tiver certeza que é uma intenção relacionada a categorias, retorne isCategoryIntent: false.
//       `;
      
//       const completion = await openai.chat.completions.create({
//         model: "gpt-3.5-turbo",
//         messages: [
//           { role: "system", content: systemPrompt },
//           { role: "user", content: messageText }
//         ],
//         response_format: { type: "json_object" },
//         temperature: 0.3,
//       });
      
//       const response = JSON.parse(completion.choices[0].message.content);
//       console.log('Detecção de intenção categoria via GPT:', response);
      
//       // Verificação adicional para qualidade dos dados
//       if (response.isCategoryIntent && response.action === 'create') {
//         if (!response.categoryName || response.categoryName.trim() === '') {
//           console.log('Intenção de criar categoria detectada sem nome válido');
//           response.isCategoryIntent = false;
//         }
//       }
      
//       return response;
//     } catch (error) {
//       console.error('Erro ao detectar intenção de categoria:', error);
//       return { isCategoryIntent: false };
//     }
//   }
  
//   /**
//    * Cria uma nova categoria para o usuário
//    * @param {string} categoryName - Nome da categoria a ser criada
//    * @param {ObjectId} userId - ID do usuário
//    * @returns {Object} A categoria criada
//    */
//   static async createCategory(categoryName, userId) {
//     try {
//       // Validação dos parâmetros
//       if (!categoryName || !userId) {
//         console.error('Parâmetros inválidos para createCategory:', { categoryName, userId });
//         throw new Error('Nome da categoria e ID do usuário são obrigatórios');
//       }
      
//       const db = await getDb("plenna_db");
//       const categoriesCollection = db.collection("Categories");
      
//       // Converter userId para ObjectId se for string
//       const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
      
//       // Verificar se a categoria já existe para este usuário
//       const existingCategory = await categoriesCollection.findOne({ 
//         userId: userObjectId,
//         name: { $regex: new RegExp(`^${categoryName}$`, 'i') } // Case insensitive
//       });
      
//       if (existingCategory) {
//         console.log(`Categoria "${categoryName}" já existe para o usuário ${userObjectId}`);
//         return existingCategory;
//       }
      
//       // Criar nova categoria com primeira letra maiúscula
//       const formattedName = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
      
//       const result = await categoriesCollection.insertOne({
//         name: formattedName,
//         userId: userObjectId,
//         createdAt: new Date(),
//         updatedAt: new Date()
//       });
      
//       const newCategory = {
//         _id: result.insertedId,
//         name: formattedName,
//         userId: userObjectId,
//         createdAt: new Date(),
//         updatedAt: new Date()
//       };
      
//       console.log(`Nova categoria "${formattedName}" criada para o usuário ${userObjectId}`);
//       return newCategory;
//     } catch (error) {
//       console.error('Erro ao criar categoria:', error);
//       throw error;
//     }
//   }
  
//   /**
//    * Lista todas as categorias do usuário
//    * @param {ObjectId} userId - ID do usuário
//    * @returns {Array} Lista de categorias do usuário
//    */
//   static async listCategories(userId) {
//     try {
//       // Validação dos parâmetros
//       if (!userId) {
//         console.error('ID do usuário não fornecido para listCategories');
//         throw new Error('ID do usuário é obrigatório');
//       }
      
//       const db = await getDb("plenna_db");
//       const categoriesCollection = db.collection("Categories");
      
//       // Converter userId para ObjectId se for string
//       const userObjectId = typeof userId === 'string' ? new ObjectId(userId) : userId;
      
//       // Buscar categorias do usuário
//       let userCategories = await categoriesCollection.find({ userId: userObjectId })
//         .sort({ name: 1 }) // Ordenar alfabeticamente
//         .toArray();
      
//       // Criar categorias padrão se necessário
//       if (!userCategories || userCategories.length === 0) {
//         userCategories = await createDefaultCategories(userObjectId);
//       }
      
//       return userCategories;
//     } catch (error) {
//       console.error('Erro ao listar categorias:', error);
//       throw error;
//     }
//   }

  
// }

// export {
//   CategoryController
// };
