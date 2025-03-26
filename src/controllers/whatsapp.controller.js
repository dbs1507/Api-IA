import axios from "axios";
import dotenv from "dotenv";
import { getDb } from "../services/db.js";
import {
    categorizeExpense,
    createCategory,
    detectBudgetIntent,
    detectCategoryIntent,
    detectExpenseIntent,
    generateResponse,
    listCategories
} from "../services/openIA.js";
import BudgetController from "./budget.controller.js";
import ExpenseController from "./expense.controller.js";

dotenv.config();

export default class WhatsApp {

    static setupWebhook(req, res) {
        // Retornamos status de sucesso
        return res.status(200).json({ 
            success: true, 
            message: 'Webhook já está configurado e funcionando. Aguardando mensagens...' 
        });
    }

    static async getOrCreateUserByPhone(phoneNumber) {
        try {
            // Validação básica
            if (!phoneNumber) {
                throw new Error('Número de telefone não fornecido');
            }
            
            const db = await getDb("plenna_db");
            const usersCollection = db.collection("Users");
            
            // Busca o usuário pelo número de telefone
            let user = await usersCollection.findOne({ phoneNumber });
            
            // Se o usuário não existir, cria um novo
            if (!user) {
                // Formata o nome com os últimos 4 dígitos para melhor identificação
                const name = `Usuário ${phoneNumber.slice(-4)}`;
                
                const result = await usersCollection.insertOne({
                    phoneNumber,
                    name,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                
                user = {
                    _id: result.insertedId,
                    phoneNumber,
                    name,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                
                console.log(`Novo usuário criado: ${user._id} (${phoneNumber})`);
            }
            
            return user;
        } catch (error) {
            console.error(`Erro ao buscar/criar usuário para ${phoneNumber}:`, error);
            throw error;
        }
    }

    static async replyToMessage(senderNumber, messageText, messageId) {
        try {
            console.log(`Obtendo resposta para: "${messageText}"`);
            
            // 1. Obter ou criar usuário
            const user = await this.getOrCreateUserByPhone(senderNumber);
            
            // 2. Verificar múltiplas intenções na ordem de prioridade
            
            // 2.1. Verificar se é uma intenção relacionada a categorias
            const categoryIntent = await detectCategoryIntent(messageText);
            
            if (categoryIntent.isCategoryIntent) {
                if (categoryIntent.action === 'list') {
                    // Listar categorias do usuário
                    await this.handleListCategories(user, senderNumber, messageId);
                    return;
                } else if (categoryIntent.action === 'create' && categoryIntent.categoryName) {
                    // Criar nova categoria
                    await this.handleCreateCategory(user, categoryIntent.categoryName, senderNumber, messageId);
                    return;
                }
            }
    
            // 2.2. Verificar se é uma intenção relacionada a orçamentos
            const budgetIntent = await detectBudgetIntent(messageText);
            console.log('Budget intent result:', JSON.stringify(budgetIntent));

            if (budgetIntent && budgetIntent.isBudgetIntent) {
                console.log(`Detectada intenção de orçamento: ${budgetIntent.action}`);
                
                // Verificação adicional para debug
                if (budgetIntent.action === 'create') {
                    console.log(`Dados da criação: categoria=${budgetIntent.categoryName}, valor=${budgetIntent.amount}`);
                }
                
                switch (budgetIntent.action) {
                    case 'info':
                        // Informações gerais sobre orçamentos
                        await this.handleBudgetInfo(user, senderNumber, messageId);
                        return;
                        
                    case 'create':
                        // Criar/atualizar orçamento
                        if (budgetIntent.categoryName && budgetIntent.amount) {
                            try {
                                console.log(`Iniciando criação de orçamento: ${budgetIntent.categoryName}, ${budgetIntent.amount}`);
                                await this.handleCreateBudget(user, budgetIntent.categoryName, budgetIntent.amount, senderNumber, messageId);
                            } catch (error) {
                                console.error('Erro ao criar orçamento:', error);
                                await this.sendWhatsAppMessage(
                                    senderNumber, 
                                    "Desculpe, encontrei um problema ao processar seu orçamento. Pode tentar novamente?", 
                                    messageId
                                );
                            }
                        } else {
                            console.log('Dados incompletos para criação de orçamento');
                            await this.sendWhatsAppMessage(
                                senderNumber, 
                                "Para criar um orçamento, por favor me informe a categoria e o valor. Por exemplo: orçamento alimentação 800", 
                                messageId
                            );
                        }
                        return;
                        
                    case 'check':
                        // Verificar progresso de orçamento
                        await this.handleCheckBudget(user, budgetIntent.categoryName, senderNumber, messageId);
                        return;
                        
                    case 'delete':
                        // Excluir orçamento
                        await this.handleDeleteBudget(user, budgetIntent.categoryName, senderNumber, messageId);
                        return;
                        
                    default:
                        // Se detectou intenção de orçamento mas não identificou ação específica
                        console.log('Ação de orçamento não específica, redirecionando para handleBudgetInfo');
                        await this.handleBudgetInfo(user, senderNumber, messageId);
                        return;
                }
            }
                        
            // 2.3. Verificar se é uma intenção de registrar despesa
            const expenseData = await detectExpenseIntent(messageText);
            
            // Variável para armazenar despesa registrada
            let registeredExpense = null;
            
            // 3. Se for uma despesa, registrar no banco
            if (expenseData.isExpense && expenseData.description && expenseData.amount) {
                try {
                    // Categorizar a despesa
                    const category = await categorizeExpense(expenseData.description, user._id);
                    
                    if (category && category._id) {
                        // Registrar a despesa
                        registeredExpense = await ExpenseController.createExpense({
                            description: expenseData.description,
                            amount: expenseData.amount,
                            userId: user._id,
                            categoryId: category._id,
                            date: expenseData.date ? new Date(expenseData.date) : new Date()
                        });
                        
                        console.log(`Despesa registrada: ${registeredExpense._id}`);
                    } else {
                        console.error("Erro: Categoria não encontrada ou inválida");
                    }
                } catch (expenseError) {
                    console.error("Erro ao registrar despesa:", expenseError);
                }
            }
            
            // 4. Decidir o tipo de resposta
            
            // 4.1 Se registrou uma despesa válida, usar resposta de confirmação
            if (registeredExpense && registeredExpense.category) {
                const standardResponse = this.getExpenseConfirmationResponse(registeredExpense);
                await this.sendWhatsAppMessage(senderNumber, standardResponse, messageId);
                return;
            }
            
            // 4.2 Para outros tipos de mensagem, preparar contexto para resposta
            
            // Buscar despesas recentes para adicionar contexto
            let recentExpenses = [];
            if (messageText.toLowerCase().includes("despesa") || 
                messageText.toLowerCase().includes("gasto") || 
                messageText.toLowerCase().includes("gastos")) {
                try {
                    recentExpenses = await ExpenseController.getUserExpenses(user._id, { limit: 5 });
                } catch (error) {
                    console.error('Erro ao buscar despesas recentes:', error);
                }
            }
            
            // 5. Gerar resposta contextual
            const contextData = {
                user,
                registeredExpense,
                recentExpenses
            };
            
            const agentResponse = await generateResponse(messageText, contextData);
            console.log(`Resposta gerada: "${agentResponse.substring(0, 50)}..."`);
            
            // 6. Enviar resposta
            await this.sendWhatsAppMessage(senderNumber, agentResponse, messageId);
            
        } catch (error) {
            console.error('Erro ao processar mensagem:', error);
            
            // Envia uma mensagem de fallback em caso de erro
            await this.sendFallbackMessage(senderNumber, messageId);
            throw error;
        }
    }

    /**
     * Gerencia o onboarding e ajuda para orçamentos
     * @param {Object} user - Objeto do usuário
     * @param {string} senderNumber - Número do remetente
     * @param {string} messageId - ID da mensagem para resposta
     */
    static async handleBudgetHelp(user, senderNumber, messageId) {
        try {
            // Verificar se o usuário já tem algum orçamento
            const db = await getDb("plenna_db");
            const budgetsCollection = db.collection("Budget");
            
            const existingBudgets = await budgetsCollection.find({
                userId: user._id
            }).count();
            
            let response;
            
            if (existingBudgets === 0) {
                // Usuário ainda não tem orçamentos - Mensagem de introdução
                response = `🎯 *Vamos Começar com seus Orçamentos!*\n\n` +
                        `Os orçamentos ajudam você a controlar seus gastos definindo limites por categoria. Vamos criar seu primeiro orçamento?\n\n` +
                        `*Como criar um orçamento:*\n` +
                        `Envie uma mensagem com o formato:\n` +
                        `"orçamento [categoria] [valor]"\n\n` +
                        `*Exemplos:*\n` +
                        `✅ orçamento Alimentação 800\n` +
                        `✅ orçamento Transporte 300\n` +
                        `✅ orçamento Lazer 500\n\n` +
                        `*Importante:* Você só pode criar orçamentos para categorias que já existem.\n\n` +
                        `Para ver suas categorias disponíveis, envie "listar categorias".`;
            } else {
                // Usuário já tem orçamentos - Mensagem com comandos disponíveis
                response = `📊 *Guia de Orçamentos*\n\n` +
                        `*Comandos disponíveis:*\n\n` +
                        `📋 *Ver todos os orçamentos:*\n` +
                        `"meus orçamentos" ou "listar orçamentos"\n\n` +
                        `➕ *Criar ou atualizar orçamento:*\n` +
                        `"orçamento [categoria] [valor]"\n` +
                        `Exemplo: orçamento Alimentação 800\n\n` +
                        `🔍 *Verificar um orçamento específico:*\n` +
                        `"verificar orçamento [categoria]"\n` +
                        `Exemplo: verificar orçamento Lazer\n\n` +
                        `❌ *Excluir um orçamento:*\n` +
                        `"excluir orçamento [categoria]"\n` +
                        `Exemplo: excluir orçamento Transporte\n\n` +
                        `💡 *Dica:* Os orçamentos são mensais e se renovam automaticamente no início de cada mês.`;
            }
            
            // Verificar categorias do usuário
            const categoriesCollection = db.collection("Categories");
            const categories = await categoriesCollection.find({ userId: user._id })
                .sort({ name: 1 })
                .limit(8) // Limitar para não ficar muito grande
                .toArray();
                
            if (categories && categories.length > 0) {
                response += `\n\n*Categorias Disponíveis:*\n`;
                const categoryNames = categories.map(cat => cat.name).join(', ');
                response += categoryNames;
                
                if (categories.length === 8) {
                    response += ", e outras...";
                }
            }
            
            await this.sendWhatsAppMessage(senderNumber, response, messageId);
        } catch (error) {
            console.error('Erro ao processar ajuda de orçamentos:', error);
            await this.sendWhatsAppMessage(
                senderNumber, 
                "Ops! Tive um problema ao processar sua solicitação sobre orçamentos. Pode tentar novamente?", 
                messageId
            );
        }
    }

    /**
     * Gerencia a listagem de orçamentos do usuário
     * @param {Object} user - Objeto do usuário
     * @param {string} senderNumber - Número do remetente
     * @param {string} messageId - ID da mensagem para resposta
     */
    static async handleListBudgets(user, senderNumber, messageId) {
        try {
            // Obter mês e ano atuais para filtrar
            const currentDate = new Date();
            const currentMonth = currentDate.getMonth() + 1; // 1-12
            const currentYear = currentDate.getFullYear();
            
            // Buscar orçamentos com progresso
            const budgetsWithProgress = await BudgetController.calculateBudgetProgress(
                user._id, 
                { month: currentMonth, year: currentYear }
            );
            
            if (!budgetsWithProgress || budgetsWithProgress.length === 0) {
                await this.sendWhatsAppMessage(
                    senderNumber, 
                    "Você ainda não definiu nenhum orçamento para este mês. Para criar um orçamento, envie: \"orçamento [categoria] [valor]\".\n\nExemplo: orçamento Alimentação 800", 
                    messageId
                );
                return;
            }
            
            // Formatar a resposta
            const monthNames = [
                'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
            ];
            
            let response = `📊 *Seus Orçamentos - ${monthNames[currentMonth-1]}/${currentYear}*\n\n`;
            
            // Formatar cada orçamento
            budgetsWithProgress.forEach((budget) => {
                const percentText = budget.percentage >= 100 
                    ? "⚠️ *Estourado!*" 
                    : `${budget.percentage}%`;
                    
                const progressBar = this.generateProgressBar(budget.percentage);
                
                response += `*${budget.category?.name || 'Categoria Desconhecida'}*\n`;
                response += `${progressBar} ${percentText}\n`;
                response += `💰 Orçado: R$ ${budget.amount.toFixed(2)}\n`;
                response += `💸 Gasto: R$ ${budget.spent.toFixed(2)}\n`;
                
                if (budget.percentage < 100) {
                    response += `✅ Restante: R$ ${budget.remaining.toFixed(2)}\n`;
                }
                
                response += `\n`;
            });
            
            response += `💡 *Dica:* Para criar um novo orçamento, envie "orçamento [categoria] [valor]"`;
            
            // Enviar a resposta
            await this.sendWhatsAppMessage(senderNumber, response, messageId);
        } catch (error) {
            console.error('Erro ao listar orçamentos:', error);
            await this.sendWhatsAppMessage(
                senderNumber, 
                "Ops! Tive um problema ao listar seus orçamentos. Pode tentar novamente?", 
                messageId
            );
        }
    }

    /**
     * Gera uma barra de progresso para visualização
     * @param {number} percentage - Porcentagem de progresso
     * @returns {string} Barra de progresso em texto
     */
    static generateProgressBar(percentage) {
        const fullBlocks = Math.min(10, Math.floor(percentage / 10));
        
        let progressBar = "";
        
        // Adicionar blocos cheios
        for (let i = 0; i < fullBlocks; i++) {
            progressBar += "█";
        }
        
        // Adicionar espaços vazios
        for (let i = fullBlocks; i < 10; i++) {
            progressBar += "▒";
        }
        
        return progressBar;
    }


/**
 * Gerencia a criação/atualização de um orçamento de forma conversacional
 * @param {Object} user - Objeto do usuário
 * @param {string} categoryName - Nome da categoria
 * @param {number} amount - Valor do orçamento
 * @param {string} senderNumber - Número do remetente
 * @param {string} messageId - ID da mensagem para resposta
 */
static async handleCreateBudget(user, categoryName, amount, senderNumber, messageId) {
    try {
        console.log(`Tentando criar orçamento: Categoria=${categoryName}, Valor=${amount}, UserId=${user._id}`);
        
        // Validação básica
        if (!categoryName || !amount || amount <= 0) {
            console.log("Dados insuficientes para criar orçamento");
            await this.sendWhatsAppMessage(
                senderNumber, 
                `Para criar um orçamento, preciso saber qual categoria e qual valor você quer definir. Por exemplo, você pode me dizer "orçamento alimentação 800" para definir R$800 para alimentação.`, 
                messageId
            );
            return;
        }
        
        // Buscar a categoria pelo nome
        const db = await getDb("plenna_db");
        const categoriesCollection = db.collection("Categories");
        
        // Verificar se existe a coleção Categories
        const categoriesExists = await db.listCollections({ name: "Categories" }).hasNext();
        if (!categoriesExists) {
            console.log("ATENÇÃO: Collection 'Categories' não existe no banco de dados!");
            await this.sendWhatsAppMessage(
                senderNumber, 
                "Não encontrei nenhuma categoria cadastrada. Vamos criar uma categoria primeiro?", 
                messageId
            );
            return;
        }
        
        // Converter para ObjectId e garantir formato correto
        const userObjectId = typeof user._id === 'string' ? new ObjectId(user._id) : user._id;
        
        console.log(`Buscando categoria: ${categoryName} para usuário ${userObjectId.toString()}`);
        
        // Usar find em vez de findOne para debug (saber se há resultados próximos)
        const allCategories = await categoriesCollection.find({
            userId: userObjectId
        }).toArray();
        
        console.log(`Total de categorias do usuário: ${allCategories.length}`);
        
        if (allCategories.length === 0) {
            await this.sendWhatsAppMessage(
                senderNumber, 
                "Você ainda não possui categorias. Vamos criar uma? Envie 'criar categoria Alimentação' por exemplo.", 
                messageId
            );
            return;
        }
        
        // Mostrar todas as categorias disponíveis no log para debug
        console.log("Categorias disponíveis:");
        allCategories.forEach(cat => console.log(` - ${cat.name} (ID: ${cat._id})`));
        
        // Buscar a categoria específica por nome (case insensitive)
        const category = await categoriesCollection.findOne({
            userId: userObjectId,
            name: { $regex: new RegExp(`^${categoryName}$`, 'i') }
        });
        
        if (!category) {
            console.log(`Categoria '${categoryName}' não encontrada`);
            
            // Preparar lista de categorias disponíveis
            const categoryList = allCategories.map(cat => cat.name).join(", ");
            
            await this.sendWhatsAppMessage(
                senderNumber, 
                `Não encontrei a categoria "${categoryName}". Suas categorias disponíveis são: ${categoryList}`, 
                messageId
            );
            return;
        }
        
        console.log(`Categoria encontrada: ${category.name} (ID: ${category._id})`);
        
        // Verificar se existe a coleção Budgets
        const budgetsExists = await db.listCollections({ name: "Budgets" }).hasNext();
        if (!budgetsExists) {
            console.log("ATENÇÃO: Collection 'Budgets' não existe no banco de dados! Criando...");
            await db.createCollection("Budgets");
        }
        
        // Obter mês e ano atuais para o orçamento
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1; // 1-12
        const currentYear = currentDate.getFullYear();
        
        // Criar ou atualizar o orçamento
        console.log(`Criando orçamento: userId=${userObjectId}, categoryId=${category._id}, amount=${amount}, month=${currentMonth}, year=${currentYear}`);
        
        const budgetData = {
            userId: userObjectId,
            categoryId: category._id,
            amount: amount,
            month: currentMonth,
            year: currentYear
        };
        
        // Criar ou atualizar o orçamento no banco
        const result = await BudgetController.createOrUpdateBudget(budgetData);
        
        if (!result) {
            throw new Error("Falha ao processar orçamento: resultado vazio");
        }
        
        console.log(`Resultado da operação de orçamento:`, result);
        
        // Verificar se o orçamento foi realmente criado/atualizado
        const budgetsCollection = db.collection("Budgets");
        const verifyBudget = await budgetsCollection.findOne({
            userId: userObjectId,
            categoryId: category._id,
            month: currentMonth,
            year: currentYear
        });
        
        if (!verifyBudget) {
            console.error("ALERTA: Orçamento não encontrado após criação/atualização!");
        } else {
            console.log(`Verificação OK: Orçamento encontrado com ID ${verifyBudget._id}`);
        }
        
        // Gerar uma resposta natural baseada no resultado
        const monthNames = [
            'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
            'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
        ];
        
        let response;
        
        if (result.isUpdate) {
            // Foi uma atualização de orçamento existente
            response = `Ótimo! Atualizei seu orçamento de ${category.name} para R$${amount.toFixed(2)} para ${monthNames[currentMonth-1]}.`;
        } else {
            // Foi um novo orçamento
            response = `Pronto! Criei um orçamento de R$${amount.toFixed(2)} para ${category.name} para ${monthNames[currentMonth-1]}.`;
        }
        
        // Adicionar informação de verificação na resposta (apenas para debug)
        if (verifyBudget) {
            response += `\n\nSeu orçamento foi salvo com sucesso no banco de dados!`;
        }
        
        // Enviar a resposta ao usuário
        await this.sendWhatsAppMessage(senderNumber, response, messageId);
        
    } catch (error) {
        console.error('Erro ao criar orçamento:', error);
        console.error('Stack trace:', error.stack);
        await this.sendWhatsAppMessage(
            senderNumber, 
            "Desculpe, tive um problema técnico para criar seu orçamento. Por favor, tente novamente mais tarde.", 
            messageId
        );
    }
}

/**
 * Gerencia informações gerais sobre orçamentos de forma conversacional
 * @param {Object} user - Objeto do usuário
 * @param {string} senderNumber - Número do remetente
 * @param {string} messageId - ID da mensagem para resposta
 */
static async handleBudgetInfo(user, senderNumber, messageId) {
    try {
        // Verificar se o usuário já tem orçamentos
        const userBudgets = await BudgetController.getUserBudgets(user._id);
        
        // Buscar categorias do usuário para contextualizar a resposta
        const db = await getDb("plenna_db");
        const categoriesCollection = db.collection("Categories");
        const categories = await categoriesCollection.find({ userId: user._id })
            .sort({ name: 1 })
            .limit(5)
            .toArray();
        
        const monthNames = [
            'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
            'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
        ];
        
        const currentMonth = new Date().getMonth();
        
        let response;
        
        if (userBudgets && userBudgets.length > 0) {
            // Usuário já tem orçamentos - resposta personalizada
            const totalBudget = userBudgets.reduce((sum, budget) => sum + budget.amount, 0);
            const totalSpent = userBudgets.reduce((sum, budget) => sum + (budget.spent || 0), 0);
            const percentSpent = totalBudget > 0 ? ((totalSpent / totalBudget) * 100).toFixed(1) : 0;
            
            response = `Você tem ${userBudgets.length} orçamento${userBudgets.length > 1 ? 's' : ''} definido${userBudgets.length > 1 ? 's' : ''} para ${monthNames[currentMonth]}, totalizando R$${totalBudget.toFixed(2)}. `;
            
            if (totalSpent > 0) {
                response += `Até agora, você já gastou R$${totalSpent.toFixed(2)} (${percentSpent}%) do total orçado. `;
            }
            
            // Adicionar uma dica personalizada com base no progresso
            if (percentSpent > 90) {
                response += `Atenção! Você já utilizou quase todo seu orçamento para este mês.`;
            } else if (percentSpent > 70) {
                response += `Você já utilizou boa parte do seu orçamento, fique de olho nos gastos.`;
            } else {
                response += `Você ainda tem uma boa parte do seu orçamento disponível para este mês.`;
            }
        } else {
            // Usuário ainda não tem orçamentos - onboarding suave
            response = `Os orçamentos te ajudam a controlar seus gastos por categoria. `;
            
            if (categories && categories.length > 0) {
                // Sugere categorias existentes para orçamentos
                const categoryExample = categories[0].name.toLowerCase();
                response += `Por exemplo, você pode definir quanto planeja gastar com ${categoryExample} em ${monthNames[currentMonth]}. `;
                response += `Para criar um orçamento, basta me dizer algo como "orçamento ${categoryExample} 500" para definir R$500 para ${categoryExample}.`;
            } else {
                // Instrução genérica se não tiver categorias
                response += `Para começar, você pode me dizer "orçamento alimentação 800" para criar um orçamento de R$800 para alimentação este mês.`;
            }
        }
        
        await this.sendWhatsAppMessage(senderNumber, response, messageId);
        
    } catch (error) {
        console.error('Erro ao processar informações de orçamento:', error);
        await this.sendWhatsAppMessage(
            senderNumber, 
            "Os orçamentos te ajudam a controlar seus gastos por categoria. Para criar um orçamento, tente enviar algo como 'orçamento alimentação 800'.", 
            messageId
        );
    }
}

/**
 * Verifica o progresso de um orçamento específico de forma conversacional
 * @param {Object} user - Objeto do usuário
 * @param {string} categoryName - Nome da categoria
 * @param {string} senderNumber - Número do remetente
 * @param {string} messageId - ID da mensagem para resposta
 */
static async handleCheckBudget(user, categoryName, senderNumber, messageId) {
    try {
        if (!categoryName) {
            // Se não especificou categoria, mostrar todos os orçamentos
            return this.handleBudgetInfo(user, senderNumber, messageId);
        }
        
        // Buscar a categoria
        const db = await getDb("plenna_db");
        const categoriesCollection = db.collection("Categories");
        
        const category = await categoriesCollection.findOne({
            userId: user._id,
            name: { $regex: new RegExp(`^${categoryName}$`, 'i') }
        });
        
        if (!category) {
            await this.sendWhatsAppMessage(
                senderNumber, 
                `Não encontrei a categoria "${categoryName}" entre suas categorias. Verifique se escreveu corretamente.`, 
                messageId
            );
            return;
        }
        
        // Buscar o orçamento para esta categoria
        const budget = await BudgetController.getBudgetByCategory(user._id, category._id);
        
        const monthNames = [
            'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
            'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
        ];
        
        const currentMonth = new Date().getMonth();
        
        if (!budget) {
            // Não tem orçamento para esta categoria
            await this.sendWhatsAppMessage(
                senderNumber, 
                `Você ainda não definiu um orçamento para ${category.name} neste mês. Para criar, me diga "orçamento ${category.name.toLowerCase()} [valor]", substituindo [valor] pelo valor desejado.`, 
                messageId
            );
            return;
        }
        
        // Formatar resposta conversacional com o progresso
        let response = `Seu orçamento para ${category.name} em ${monthNames[currentMonth]} é de R$${budget.amount.toFixed(2)}. `;
        
        if (budget.spent > 0) {
            // Calcular dias restantes no mês
            const today = new Date().getDate();
            const totalDays = new Date(budget.year, budget.month, 0).getDate();
            const daysRemaining = totalDays - today + 1;
            
            if (budget.isOverBudget) {
                // Orçamento estourado
                const excess = budget.spent - budget.amount;
                response += `Você já gastou R$${budget.spent.toFixed(2)}, o que significa que estourou o orçamento em R$${excess.toFixed(2)} (${budget.percentage.toFixed(0)}%).`;
            } else {
                // Dentro do orçamento
                response += `Você já gastou R$${budget.spent.toFixed(2)} (${budget.percentage.toFixed(0)}%) e ainda tem R$${budget.remaining.toFixed(2)} disponíveis.`;
                
                // Adicionar média diária se estiver nos primeiros 3/4 do mês
                if (daysRemaining > totalDays / 4) {
                    const dailyAvailable = budget.remaining / daysRemaining;
                    response += ` Para os ${daysRemaining} dias restantes deste mês, você pode gastar em média R$${dailyAvailable.toFixed(2)} por dia nesta categoria.`;
                }
            }
            
            // Adicionar algumas despesas recentes se disponíveis
            if (budget.recentExpenses && budget.recentExpenses.length > 0) {
                response += `\n\nSuas despesas mais recentes em ${category.name} foram:`;
                
                budget.recentExpenses.forEach(expense => {
                    const expenseDate = expense.date.toLocaleDateString('pt-BR');
                    response += `\n- ${expense.description}: R$${expense.amount.toFixed(2)} (${expenseDate})`;
                });
            }
        } else {
            // Ainda não tem gastos nesta categoria
            response += `Você ainda não registrou nenhuma despesa nesta categoria neste mês.`;
        }
        
        await this.sendWhatsAppMessage(senderNumber, response, messageId);
        
    } catch (error) {
        console.error('Erro ao verificar orçamento:', error);
        await this.sendWhatsAppMessage(
            senderNumber, 
            "Desculpe, tive um problema para verificar este orçamento. Pode tentar novamente?", 
            messageId
        );
    }
}

/**
 * Exclui um orçamento de forma conversacional
 * @param {Object} user - Objeto do usuário
 * @param {string} categoryName - Nome da categoria
 * @param {string} senderNumber - Número do remetente
 * @param {string} messageId - ID da mensagem para resposta
 */
static async handleDeleteBudget(user, categoryName, senderNumber, messageId) {
    try {
        if (!categoryName) {
            await this.sendWhatsAppMessage(
                senderNumber, 
                "Para remover um orçamento, preciso saber qual categoria. Por exemplo, 'remover orçamento alimentação'.", 
                messageId
            );
            return;
        }
        
        // Buscar a categoria
        const db = await getDb("plenna_db");
        const categoriesCollection = db.collection("Categories");
        
        const category = await categoriesCollection.findOne({
            userId: user._id,
            name: { $regex: new RegExp(`^${categoryName}$`, 'i') }
        });
        
        if (!category) {
            await this.sendWhatsAppMessage(
                senderNumber, 
                `Não encontrei a categoria "${categoryName}" entre suas categorias. Verifique se escreveu corretamente.`, 
                messageId
            );
            return;
        }
        
        // Excluir o orçamento
        const result = await BudgetController.deleteBudget(user._id, category._id);
        
        if (result.success) {
            // Resposta conversacional sobre a remoção
            await this.sendWhatsAppMessage(
                senderNumber, 
                `Removi o orçamento de ${category.name} para este mês. Você pode criar um novo a qualquer momento.`, 
                messageId
            );
        } else {
            await this.sendWhatsAppMessage(
                senderNumber, 
                `Não encontrei um orçamento ativo para ${category.name} neste mês.`, 
                messageId
            );
        }
        
    } catch (error) {
        console.error('Erro ao excluir orçamento:', error);
        await this.sendWhatsAppMessage(
            senderNumber, 
            "Desculpe, tive um problema para remover este orçamento. Pode tentar novamente?", 
            messageId
        );
    }
}
    /**
     * Gerencia a verificação do progresso de um orçamento
     * @param {Object} user - Objeto do usuário
     * @param {string} categoryName - Nome da categoria
     * @param {string} senderNumber - Número do remetente
     * @param {string} messageId - ID da mensagem para resposta
     */
    static async handleCheckBudget(user, categoryName, senderNumber, messageId) {
        try {
            // Validar dados
            if (!categoryName) {
                await this.sendWhatsAppMessage(
                    senderNumber, 
                    "Por favor, especifique qual categoria de orçamento deseja verificar.\n\nExemplo: verificar orçamento Alimentação", 
                    messageId
                );
                return;
            }
            
            // Buscar categoria pelo nome
            const db = await getDb("plenna_db");
            const categoriesCollection = db.collection("Categories");
            
            const category = await categoriesCollection.findOne({
                userId: user._id,
                name: { $regex: new RegExp(`^${categoryName}$`, 'i') }
            });
            
            if (!category) {
                await this.sendWhatsAppMessage(
                    senderNumber, 
                    `Não encontrei a categoria "${categoryName}" na sua lista de categorias.`, 
                    messageId
                );
                return;
            }
            
            // Buscar orçamento para esta categoria
            const currentDate = new Date();
            const currentMonth = currentDate.getMonth() + 1;
            const currentYear = currentDate.getFullYear();
            
            const budget = await BudgetController.getBudgetByCategory(
                user._id, 
                category._id, 
                { month: currentMonth, year: currentYear }
            );
            
            if (!budget) {
                await this.sendWhatsAppMessage(
                    senderNumber, 
                    `Você ainda não definiu um orçamento para a categoria "${category.name}" neste mês. Para criar, envie: "orçamento ${category.name} [valor]"`, 
                    messageId
                );
                return;
            }
            
            // Calcular progresso do orçamento
            const expensesCollection = db.collection("Expenses");
            
            // Calcular datas de início e fim do mês
            const startDate = new Date(currentYear, currentMonth - 1, 1);
            const endDate = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);
            
            // Buscar despesas desta categoria no período
            const expenses = await expensesCollection.find({
                userId: user._id,
                categoryId: category._id,
                date: { $gte: startDate, $lte: endDate }
            }).toArray();
            
            // Calcular total gasto
            const spent = expenses.reduce((total, expense) => total + expense.amount, 0);
            
            // Calcular percentual
            const percentage = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
            const remaining = Math.max(0, budget.amount - spent);
            
            // Formatar resposta
            const monthNames = [
                'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
            ];
            
            let response = `📊 *Progresso do Orçamento - ${category.name}*\n\n`;
            
            const percentText = percentage >= 100 
                ? "⚠️ *Estourado!*" 
                : `${percentage.toFixed(1)}%`;
                
            const progressBar = this.generateProgressBar(percentage);
            
            response += `${progressBar} ${percentText}\n\n`;
            response += `📅 *Período:* ${monthNames[currentMonth-1]}/${currentYear}\n`;
            response += `💰 *Orçado:* R$ ${budget.amount.toFixed(2)}\n`;
            response += `💸 *Gasto:* R$ ${spent.toFixed(2)}\n`;
            
            if (percentage < 100) {
                response += `✅ *Restante:* R$ ${remaining.toFixed(2)}\n`;
                
                // Calcular média diária disponível
                const today = new Date().getDate();
                const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
                const remainingDays = daysInMonth - today + 1;
                
                if (remainingDays > 0 && remaining > 0) {
                    const dailyAvailable = remaining / remainingDays;
                    response += `📊 *Média diária disponível:* R$ ${dailyAvailable.toFixed(2)}/dia\n`;
                }
            } else {
                response += `⚠️ *Excedido:* R$ ${Math.abs(remaining).toFixed(2)}\n`;
            }
            
            // Adicionar algumas despesas recentes dessa categoria
            if (expenses.length > 0) {
                response += `\n📝 *Despesas Recentes:*\n`;
                
                // Ordenar por data (mais recentes primeiro) e limitar a 3
                const recentExpenses = expenses
                    .sort((a, b) => b.date - a.date)
                    .slice(0, 3);
                    
                recentExpenses.forEach(expense => {
                    const expenseDate = expense.date.toLocaleDateString('pt-BR');
                    response += `- ${expense.description}: R$ ${expense.amount.toFixed(2)} (${expenseDate})\n`;
                });
            }
            
            // Enviar resposta
            await this.sendWhatsAppMessage(senderNumber, response, messageId);
        } catch (error) {
            console.error('Erro ao verificar orçamento:', error);
            await this.sendWhatsAppMessage(
                senderNumber, 
                "Ops! Tive um problema ao verificar seu orçamento. Pode tentar novamente?", 
                messageId
            );
        }
    }

    /**
     * Gerencia a exclusão de um orçamento
     * @param {Object} user - Objeto do usuário
     * @param {string} categoryName - Nome da categoria
     * @param {string} senderNumber - Número do remetente
     * @param {string} messageId - ID da mensagem para resposta
     */
    static async handleDeleteBudget(user, categoryName, senderNumber, messageId) {
        try {
            // Validar dados
            if (!categoryName) {
                await this.sendWhatsAppMessage(
                    senderNumber, 
                    "Por favor, especifique qual categoria de orçamento deseja excluir.\n\nExemplo: excluir orçamento Alimentação", 
                    messageId
                );
                return;
            }
            
            // Buscar categoria pelo nome
            const db = await getDb("plenna_db");
            const categoriesCollection = db.collection("Categories");
            
            const category = await categoriesCollection.findOne({
                userId: user._id,
                name: { $regex: new RegExp(`^${categoryName}$`, 'i') }
            });
            
            if (!category) {
                await this.sendWhatsAppMessage(
                    senderNumber, 
                    `Não encontrei a categoria "${categoryName}" na sua lista de categorias.`, 
                    messageId
                );
                return;
            }
            
            // Excluir orçamento
            const deleted = await BudgetController.deleteBudget(
                user._id, 
                category._id
            );
            
            if (deleted) {
                await this.sendWhatsAppMessage(
                    senderNumber, 
                    `✅ Orçamento da categoria "${category.name}" excluído com sucesso!`, 
                    messageId
                );
            } else {
                await this.sendWhatsAppMessage(
                    senderNumber, 
                    `Não encontrei um orçamento ativo para a categoria "${category.name}" neste mês.`, 
                    messageId
                );
            }
        } catch (error) {
            console.error('Erro ao excluir orçamento:', error);
            await this.sendWhatsAppMessage(
                senderNumber, 
                "Ops! Tive um problema ao excluir seu orçamento. Pode tentar novamente?", 
                messageId
            );
        }
    }
    
    /**
     * Gerencia a listagem de categorias do usuário
     * @param {Object} user - Objeto do usuário
     * @param {string} senderNumber - Número do remetente
     * @param {string} messageId - ID da mensagem para resposta
     */
    static async handleListCategories(user, senderNumber, messageId) {
        try {
            // Buscar todas as categorias do usuário
            const categories = await listCategories(user._id);
            
            if (!categories || categories.length === 0) {
                await this.sendWhatsAppMessage(
                    senderNumber, 
                    "Você ainda não tem categorias personalizadas. Vou criar algumas categorias padrão para você!", 
                    messageId
                );
                
                // Tentar criar categorias padrão e listar novamente
                await listCategories(user._id);
                return this.handleListCategories(user, senderNumber, messageId);
            }
            
            // Formatar a resposta
            let response = `📋 *Suas Categorias*\n\n`;
            
            categories.forEach((category, index) => {
                response += `${index + 1}. ${category.name}\n`;
            });
            
            response += `\n✨ *Total:* ${categories.length} categorias\n`;
            response += `\n💡 *Dica:* Para criar uma nova categoria, envie "criar categoria [nome]"`;
            
            // Enviar a resposta
            await this.sendWhatsAppMessage(senderNumber, response, messageId);
            
        } catch (error) {
            console.error('Erro ao listar categorias:', error);
            await this.sendWhatsAppMessage(
                senderNumber, 
                "Ops! Tive um problema ao listar suas categorias. Pode tentar novamente?", 
                messageId
            );
        }
    }
    
    /**
     * Gerencia a criação de nova categoria
     * @param {Object} user - Objeto do usuário
     * @param {string} categoryName - Nome da categoria a ser criada
     * @param {string} senderNumber - Número do remetente
     * @param {string} messageId - ID da mensagem para resposta
     */
    static async handleCreateCategory(user, categoryName, senderNumber, messageId) {
        try {
            // Verificar se o nome da categoria é válido
            if (!categoryName || categoryName.trim().length === 0) {
                await this.sendWhatsAppMessage(
                    senderNumber, 
                    "Por favor, forneça um nome válido para a categoria. Exemplo: criar categoria Viagens", 
                    messageId
                );
                return;
            }
            
            // Buscar categorias existentes para verificar duplicatas
            const existingCategories = await listCategories(user._id);
            const isDuplicate = existingCategories.some(
                cat => cat.name.toLowerCase() === categoryName.toLowerCase()
            );
            
            if (isDuplicate) {
                await this.sendWhatsAppMessage(
                    senderNumber, 
                    `Você já tem uma categoria chamada "${categoryName}". Suas categorias atuais são:\n\n` + 
                    existingCategories.map((cat, i) => `${i + 1}. ${cat.name}`).join('\n'),
                    messageId
                );
                return;
            }
            
            // Criar a nova categoria
            const newCategory = await createCategory(categoryName, user._id);
            
            if (!newCategory || !newCategory._id) {
                throw new Error("Falha ao criar categoria");
            }
            
            // Formatar a resposta de confirmação
            const response = `✅ *Nova Categoria Criada*\n\n` +
                             `🏷️ *Nome:* ${newCategory.name}\n\n` +
                             `Agora você pode registrar despesas nesta categoria!`;
            
            // Enviar a resposta
            await this.sendWhatsAppMessage(senderNumber, response, messageId);
            
        } catch (error) {
            console.error('Erro ao criar categoria:', error);
            await this.sendWhatsAppMessage(
                senderNumber, 
                "Ops! Tive um problema ao criar sua categoria. Pode tentar novamente?", 
                messageId
            );
        }
    }
    
    // Método para enviar mensagem WhatsApp 
    static async sendWhatsAppMessage(senderNumber, text, messageId = null) {
        try {
            const options = {
                method: 'POST',
                url: 'https://plenna.uazapi.com/send/text',
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                  token: process.env.AUTH_TOKEN
                },
                data: {
                  number: senderNumber,
                  text,
                  linkPreview: false,
                  replyid: messageId,
                  mentions: '',
                  readchat: true,
                  senderName: 'Plenna',
                  useTemplateButtons: false,
                  isGroup: false,
                  delay: 1000
                }
            };
            
            console.log(`Enviando resposta para ${senderNumber}`);
            const { data } = await axios.request(options);
            console.log('Resposta enviada com sucesso');
            return data;
        } catch (error) {
            console.error('Erro ao enviar mensagem WhatsApp:', error);
            throw error;
        }
    }
    
    // Método para enviar mensagem de fallback em caso de erro
    static async sendFallbackMessage(senderNumber, messageId = null) {
        const fallbackMessage = "Desculpe, estou com dificuldades técnicas no momento. Tente novamente em alguns instantes ou entre em contato com o suporte.";
        try {
            return await this.sendWhatsAppMessage(senderNumber, fallbackMessage, messageId);
        } catch (error) {
            console.error('Erro ao enviar mensagem de fallback:', error);
        }
    }
    
    // Método para gerar resposta padrão para despesas registradas
    static getExpenseConfirmationResponse(expense) {
        if (!expense || !expense.description || !expense.amount || !expense.category) {
            return "✅ Despesa registrada! Mas tive um pequeno problema ao recuperar os detalhes. Você pode verificar seu extrato para confirmar.";
        }
        
        try {
            const formattedAmount = typeof expense.amount === 'number' 
                ? expense.amount.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}) 
                : `R$ ${expense.amount}`;
                
            const categoryName = expense.category.name || "Categoria não especificada";
            const date = expense.date instanceof Date 
                ? expense.date.toLocaleDateString('pt-BR') 
                : "hoje";
            
            // Dicas personalizadas por categoria
            const spendingAdvice = {
                'Alimentação': 'Lembre-se de planejar suas refeições para economizar!',
                'Transporte': 'Já considerou alternativas de transporte para reduzir custos?',
                'Lazer': 'Equilibre seus gastos com lazer para manter suas finanças saudáveis.',
                'Moradia': 'Verifique se há oportunidades de reduzir custos com moradia.',
                'Saúde': 'Investir em saúde é importante, mas pesquise por melhores preços.',
                'Educação': 'Investir em educação é sempre um bom retorno a longo prazo!',
                'Vestuário': 'Considere fazer um planejamento sazonal para compras de roupas.',
                'Outros': 'Continue monitorando seus gastos para alcançar seus objetivos!'
            };
            
            const advice = spendingAdvice[expense.category.name] || spendingAdvice['Outros'];
            
            // Modelo de resposta simplificado - uma única versão para facilitar manutenção
            return `✅ Despesa registrada com sucesso!

📝 *Descrição:* ${expense.description}
💰 *Valor:* ${formattedAmount}
🏷️ *Categoria:* ${categoryName}
📅 *Data:* ${date}

💡 *Dica:* ${advice}`;
            
        } catch (error) {
            console.error('Erro ao gerar resposta para despesa:', error);
            return "✅ Despesa registrada com sucesso! Você pode verificar seu extrato para mais detalhes.";
        }
    }
}