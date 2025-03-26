import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

export default class AgentController {
    static async createAgent(req, res) {
        const options = {
            method: 'POST',
            url: 'https://plenna.uazapi.com/agent/edit',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              token: process.env.AUTH_TOKEN
            },
            data: {
              id: '',
              delete: false,
              agent: {
                name: 'plena.ia',
                provider: 'openai',
                apikey: process.env.GPT_API_KEY,
                basePrompt: `
                ## General Context  
                You are an intelligent financial assistant called **Plenna**, designed to help users organize their finances through **WhatsApp**, without needing spreadsheets or complex apps.  
                Your goal is to **simplify expense tracking, budget forecasting, and financial control**, providing personalized insights and helping users make better money decisions.  

                Your tone should be **friendly, accessible, and motivating**, avoiding technical jargon. The focus is on **simplicity and practicality**.  

                ##  General Rules  
                ✅ Always encourage users to reflect on their spending and offer **personalized suggestions** to improve financial organization.  
                ✅ When a user logs an expense, **generate a unique ID** and **automatically categorize** it.  
                ✅ Always **explain features in a straightforward and easy-to-understand way**.  
                ✅ If a user is close to exceeding their budget, **send alerts and recommendations**.  
                ✅ **Never provide investment advice or credit recommendations**. Your focus is **financial control and expense forecasting**.  
                ✅ Always check **existing categories** before creating a new one. Try to allocate expenses into an existing category first. If no relevant category exists, then create a new one.  
                - Example: "Restaurant" and "Food" can be merged unless the user wants them separate.  
                `,
                model: 'gpt-4o-mini',
                maxTokens: 2000,
                temperature: 70,
                diversityLevel: 50,
                frequencyPenalty: 30,
                presencePenalty: 30,
                signMessages: true,
                readMessages: true,
                maxMessageLength: 500,
                typingDelay_seconds: 2,
                contextTimeWindow_hours: 24,
                contextMaxMessages: 50,
                contextMinMessages: 3
              }
            }
        };
          
        try {
            const response = await axios(options);
            return res.status(200).json(response.data);
        } catch (error) {
            console.error('Erro ao criar agente:', error.message);
            if (error.response) {
                // Se o servidor respondeu com um status de erro
                return res.status(error.response.status).json({
                    error: error.response.data || error.message
                });
            }
            return res.status(500).json({ error: error.message });
        }
    }

    static async getAgents(req, res) {
        const options = {
            method: 'GET',
            url: 'https://plenna.uazapi.com/agent/list',
            headers: {Accept: 'application/json', token: process.env.AUTH_TOKEN}
        };

        try {
            const { data } = await axios.request(options);
            
            // Se for chamado como parte de uma requisição HTTP
            if (req && res) {
                const lastAgent = data[data.length - 1];
                return res.status(200).json(lastAgent);
            } 
            // Se for chamado internamente por outro método
            else {
                return data.length > 0 ? data[data.length - 1].id : null;
            }
        } catch (error) {
            console.error('Erro ao obter agentes:', error);
            
            // Se for chamado como parte de uma requisição HTTP
            if (req && res) {
                return res.status(500).json({ error: error.message });
            } 
            // Se for chamado internamente por outro método
            else {
                throw error;
            }
        }
    }
}