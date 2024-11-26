import { GridFSBucket } from "mongodb";
import { getDb, closeConnection } from "../services/db.js";
import OpenAI from "openai";

export default class FaamaControler {
    
    static openaiClient = new OpenAI({
        baseURL: 'http://localhost:11434/v1', // Base URL do Ollama
        apiKey: 'ollama', // Não é usada diretamente
    });

    static async recoveCSV() {
        try {
            const db = await getDb("apiIA_db");
            const files = await db.collection("csv").find({}).toArray();

            if (!files || files.length === 0) {
                console.log("Nenhum registro encontrado.");
                return [];
            }

            const csvFiles = files.map(file => ({
                _id: file._id,
                pergunta: file.pergunta || "Pergunta não definida",
                resposta: file.resposta || "Resposta não definida",
            }));

            console.log("Dados recuperados do banco:", csvFiles);
            return csvFiles;
        } catch (error) {
            console.error("Erro ao recuperar os CSVs:", error);
            throw error;
        }
    }

    static async generateEmbedding(text) {
        try {
            const response = await FaamaControler.openaiClient.embeddings.create({
                model: 'all-minilm',
                input: text,
            });
            return response.data[0].embedding;
        } catch (error) {
            console.error("Erro ao gerar embeddings:", error);
            throw error;
        }
    }

    static async processCSVs() {
        try {
            const csvFiles = await FaamaControler.recoveCSV();
            const embeddings = [];
            const documents = [];

            for (const file of csvFiles) {
                const text = `${file.pergunta} ${file.resposta}`;
                const embedding = await FaamaControler.generateEmbedding(text);

                embeddings.push(embedding);
                documents.push({
                    _id: file._id,
                    content: text,
                    metadata: {
                        pergunta: file.pergunta,
                        resposta: file.resposta,
                    },
                });

                console.log("Documento processado:", text);
            }

            console.log("Embeddings gerados:", embeddings.length);
            return { embeddings, documents };
        } catch (error) {
            console.error("Erro ao processar CSVs:", error.message);
            throw error;
        }
    }

    static async findSimilarDocuments(queryEmbedding, embeddings, documents) {
        const similarities = embeddings.map((embedding, index) => {
            if (embedding.length !== queryEmbedding.length) {
                console.error("Dimensões incompatíveis entre query e embedding!");
                return { document: documents[index], score: 0 };
            }
            return {
                document: documents[index],
                score: FaamaControler.cosineSimilarity(queryEmbedding, embedding),
            };
        });

        const topDocs = similarities.sort((a, b) => b.score - a.score).slice(0, 2);
        console.log("Documentos similares encontrados:", topDocs);
        return topDocs;
    }

    static cosineSimilarity(a, b) {
        const dotProduct = a.reduce((sum, val, idx) => sum + val * b[idx], 0);
        const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val ** 2, 0));
        const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val ** 2, 0));
        return dotProduct / (magnitudeA * magnitudeB || 1);
    }

    static async responseAssist(req, res) {
        const { text } = req.body;

        if (!text) {
            return res.status(400).send("Texto da pergunta não fornecido.");
        }

        try {
            const { embeddings, documents } = await FaamaControler.processCSVs();
            const queryEmbedding = await FaamaControler.generateEmbedding(text);
            const similarDocs = await FaamaControler.findSimilarDocuments(queryEmbedding, embeddings, documents);

            const prompt = `
            ### Pergunta do usuário:
            ${text}
            
            ### Dados relevantes:
            ${similarDocs.map((doc) => doc.document.content).join("\n\n")}
            
            ### Instruções:
            Você é uma assistente que responde exclusivamente em Português do Brasil. 
            - Responda à pergunta com base apenas nas informações fornecidas em "Dados relevantes".
            - Não mencione a origem das informações (documentos ou arquivos).
            - Use uma linguagem clara, direta e objetiva. Evite formalidades excessivas.
            - Responda sempre em Português do Brasil, sem exceções.
            `;
            

            const completion = await FaamaControler.openaiClient.chat.completions.create({
                model: 'llama2',
                messages: [
                    { role: "system", content: `Você é uma assistente que responde exclusivamente em Português do Brasil. Siga o prompt a seguir: ${prompt}` },
                    { role: "user", content: text }
                ],
            });

            return res.status(200).json(completion.choices[0].message.content);

        } catch (error) {
            console.error("Erro ao processar resposta:", error.message);
            res.status(500).send("Erro interno no servidor.");
        }
    }
}
