// #################################### Versao 1 do codigo com llama3, nomic-embed-text e memoryvector 



// import { GridFSBucket } from "mongodb";
// import { getDb, closeConnection } from "../services/db.js";
// import { MemoryVectorStore } from "langchain/vectorstores/memory";
// import axios from "axios";
// import * as pdfjsLib from "pdfjs-dist";
// import OpenAI from 'openai'

// const vectorStore = new MemoryVectorStore(); // Inicialização sem embedQuery

// export default class OrbitaController {
//     // Recupera PDFs do MongoDB
//     static async recovePDF() {
//         try {
//             const db = await getDb("apiIA_db");
//             const bucket = new GridFSBucket(db, { bucketName: "docs" });
//             const files = await db.collection("docs.files").find({}).toArray();

//             if (!files || files.length === 0) {
//                 console.log("Nenhum arquivo PDF encontrado na coleção.");
//                 return [];
//             }

//             const pdfBuffers = [];
//             for (const file of files) {
//                 const chunks = [];
//                 const downloadStream = bucket.openDownloadStream(file._id);

//                 const pdfBuffer = await new Promise((resolve, reject) => {
//                     downloadStream.on("data", (chunk) => chunks.push(chunk));
//                     downloadStream.on("end", () => resolve(Buffer.concat(chunks)));
//                     downloadStream.on("error", (err) => reject(err));
//                 });

//                 pdfBuffers.push({
//                     filename: file.filename,
//                     buffer: pdfBuffer,
//                 });

//                 console.log(`Arquivo '${file.filename}' carregado.`);
//             }

//             return pdfBuffers;
//         } catch (error) {
//             console.error("Erro ao recuperar os PDFs:", error);
//             throw error;
//         }
//     }

//     // Divide texto em chunks
//     static splitText(text, chunkSize = 512) {
//         const chunks = [];
//         for (let i = 0; i < text.length; i += chunkSize) {
//             chunks.push(text.slice(i, i + chunkSize));
//         }
//         return chunks;
//     }

//     // Gera embeddings usando a API local do Nomic
//     static async generateEmbedding(text) {
//         try {
//             const response = await axios.post("http://localhost:11434/api/embeddings", {
//                 model: "nomic-embed-text",
//                 prompt: text,
//             });
//             return response.data.embedding;
//         } catch (error) {
//             console.error("Erro ao gerar embeddings:", error);
//             throw error;
//         }
//     }

//     // Adiciona embeddings ao MemoryVectorStore
//     static async addToVectorStore(embeddings, documents) {
//         try {
//             if (!Array.isArray(embeddings) || !Array.isArray(documents)) {
//                 throw new Error("Embeddings ou documentos inválidos.");
//             }
            
//             if (embeddings.length !== documents.length) {
//                 console.error("Tamanhos incompatíveis:", {
//                     embeddingsLength: embeddings.length,
//                     documentsLength: documents.length
//                 });
//                 return;
//             }
            
//             await vectorStore.addVectors(embeddings, documents);

//         } catch (error) {
//             console.error("Erro ao adicionar ao VectorStore:", error);
//             throw error; // Relança o erro para o chamador lidar
//         }
//     }
    
//     static async findSimilarDocuments(queryEmbedding) {
//         try {
//             // Realiza a busca por similaridade com base no embedding da consulta
//             const similarDocuments = await vectorStore.similaritySearchVectorWithScore(queryEmbedding, 10);

//             if (!similarDocuments || similarDocuments.length === 0) {
//                 console.log("Nenhum documento similar encontrado.");
//                 return [];
//             }

//             // Retorna documentos com as pontuações de similaridade
//             console.log("Documentos similares encontrados:", similarDocuments);
//             return similarDocuments.map(([document, score]) => ({
//                 document,
//                 score,
//             }));
//         } catch (error) {
//             console.error("Erro ao buscar documentos similares:", error);
//             throw error;
//         }
//     }


//     static async retriveInfo() {
//         const embeddings = []; // Para armazenar os vetores
//         const documents = [];  // Para armazenar os metadados associados
    
//         try {
//             // Recupera os PDFs do banco de dados
//             const pdfBuffers = await OrbitaController.recovePDF();
    
//             // Processa cada PDF, gerando embeddings para cada página e chunk
//             for (const pdf of pdfBuffers) {
//                 console.log(`Processando: ${pdf.filename}`);
    
//                 const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdf.buffer) });
//                 const pdfDocument = await loadingTask.promise;
    
//                 for (let i = 1; i <= pdfDocument.numPages; i++) {
//                     const page = await pdfDocument.getPage(i);
//                     const textContent = await page.getTextContent();
//                     console.log("Itens extraídos da página:", textContent.items);

    
//                     const pageText = textContent.items.map((item) => item.str).join(" \n");


//                     console.log("Texto completo extraído da página:", pageText);
//                     const chunks = OrbitaController.splitText(pageText);
    
//                     // Gera embeddings para cada chunk e armazena
//                     for (const [index, chunk] of chunks.entries()) {
//                         try {
//                             const embedding = await OrbitaController.generateEmbedding(chunk);
//                             embeddings.push(embedding);
    
//                             // Cria documento associado ao embedding
//                             const doc = {
//                                 pageContent: chunk, // Alterado para "pageContent"
//                                 metadata: {
//                                     filename: pdf.filename,
//                                     page: i,
//                                     chunkIndex: index,
//                                 },
//                                 id: i
//                             };
//                             documents.push(doc);
                            
                            
    
//                             console.log("Documento sendo processado:", doc);
//                         } catch (error) {
//                             console.error(`Erro ao gerar embedding para chunk ${index} da página ${i}:`, error);
//                         }
//                     }
//                 }
//             }
    
//             // Verifica se o número de embeddings e documentos coincide
//             if (embeddings.length !== documents.length) {
//                 throw new Error("Erro: Número de embeddings não coincide com o número de documentos.");
//             }
    
//             // Adiciona os embeddings e documentos ao VectorStore
//             await vectorStore.addVectors(embeddings, documents);
//             console.log("Documentos e embeddings adicionados ao VectorStore.");
//         } catch (error) {
//             console.error("Erro ao processar a solicitação:", error);
//             throw error;
//         } finally {
//             await closeConnection();
//         }
//     }
    
    

//     // Processa a consulta do usuário
//     static async talk_ia(req, res) {
//         const { text } = req.body; // A consulta ou pergunta do usuário
    
//         try {

//             const test = await OrbitaController.retriveInfo()
//             console.log(test)
//             // Gera o embedding da pergunta enviada
//             const queryEmbedding = await OrbitaController.generateEmbedding(text);
    
//             // Busca documentos similares com base no embedding
//             const similarDocs = await OrbitaController.findSimilarDocuments(queryEmbedding);
    
//             // Verifica se foram encontrados documentos similares
//             if (similarDocs.length === 0) {
//                 return res.status(404).send("Nenhum documento semelhante encontrado.");
//             }
    
//             // // Monta uma resposta baseada nos documentos encontrados
//             // const response = {
//             //     message: "Documentos similares encontrados.",
//             //     similarDocuments: similarDocs,
//             // };

//             const prompt = `
//             Você é um assistente virtual especializado em responder perguntas com base em documentos fornecidos. Sua função é analisar as informações relevantes e responder com clareza e precisão. 
            
//             ### Instruções:
//             1. Use apenas as informações relevantes extraídas dos documentos fornecidos para responder à pergunta.
//             2. Se a pergunta não puder ser respondida com base nos documentos, indique que não há informações suficientes.
//             3. Seja objetivo, direto e mantenha a resposta profissional.
            
//             ### Dados relevantes extraídos dos documentos:
//             ${similarDocs.map((doc, index) => `Documento ${index + 1}:\n"${doc.document.pageContent}"`).join("\n\n")}
            
//             `;
            
//             const client = new OpenAI({
//                 baseURL: 'http://localhost:11434/v1',
//                 apiKey: 'ollama',
//             })
              
//             const completion = await client.chat.completions.create({
//                 model: 'llama2',
//                 messages: [
//                     {role: "system", "content": prompt},
//                     { role: 'user', content: text }
//                 ],
//             })
              
//             console.log(completion.choices[0].message.content)

//             // const response = await axios.post("http://localhost:11434/api/generate", {
//             //     model: "llama3",
//             //     prompt: prompt,
//             //     stream: false,
//             // });
    
//             // Envia os documentos similares como resposta
//             return res.status(200).json(completion.choices[0].message.content);
//             // return res.status(200).json(response.data.response.toString());

//         } catch (error) {
//             console.error("Erro ao processar a solicitação:", error);
//             return res.status(500).send("Erro ao processar a solicitação.");
//         }
//     }
    
// }



// #################################################### Versao refatorada com OpenIa client compativel com Ollama usando llama 2

// import { GridFSBucket } from "mongodb";
// import { getDb, closeConnection } from "../services/db.js";
// import axios from "axios";
// import * as pdfjsLib from "pdfjs-dist";
// import OpenAI from 'openai';

// export default class OrbitaController {
//     // Instância estática reutilizável do cliente OpenAI
//     static openaiClient = new OpenAI({
//         baseURL: 'http://localhost:11434/v1', // Base URL do Ollama
//         apiKey: 'ollama', // Não é usada diretamente
//     });

//     // Recupera PDFs do MongoDB
//     static async recovePDF() {
//         try {
//             const db = await getDb("apiIA_db");
//             const bucket = new GridFSBucket(db, { bucketName: "docs" });
//             const files = await db.collection("docs.files").find({}).toArray();

//             if (!files || files.length === 0) {
//                 console.log("Nenhum arquivo PDF encontrado na coleção.");
//                 return [];
//             }

//             const pdfBuffers = [];
//             for (const file of files) {
//                 const chunks = [];
//                 const downloadStream = bucket.openDownloadStream(file._id);

//                 const pdfBuffer = await new Promise((resolve, reject) => {
//                     downloadStream.on("data", (chunk) => chunks.push(chunk));
//                     downloadStream.on("end", () => resolve(Buffer.concat(chunks)));
//                     downloadStream.on("error", (err) => reject(err));
//                 });

//                 pdfBuffers.push({ filename: file.filename, buffer: pdfBuffer });
//                 console.log(`Arquivo '${file.filename}' carregado.`);
//             }

//             return pdfBuffers;
//         } catch (error) {
//             console.error("Erro ao recuperar os PDFs:", error);
//             throw error;
//         }
//     }

//     // Divide texto em chunks
//     static splitText(text, chunkSize = 512) {
//         return text.match(new RegExp(`.{1,${chunkSize}}`, 'g')) || [];
//     }

//     // Gera embeddings usando a API da OpenAI
//     static async generateEmbedding(text) {
//         try {
//             const response = await OrbitaController.openaiClient.embeddings.create({
//                 model: 'all-minilm',
//                 input: text,
//             });
//             return response.data[0].embedding;
//         } catch (error) {
//             console.error("Erro ao gerar embeddings:", error);
//             throw error;
//         }
//     }

//     // Processa PDFs e gera embeddings
//     static async processPDFs() {
//         try {
//             const pdfBuffers = await OrbitaController.recovePDF();
//             const embeddings = [];
//             const documents = [];

//             for (const pdf of pdfBuffers) {
//                 console.log(`Processando: ${pdf.filename}`);
//                 const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdf.buffer) });
//                 const pdfDocument = await loadingTask.promise;

//                 for (let i = 1; i <= pdfDocument.numPages; i++) {
//                     const page = await pdfDocument.getPage(i);
//                     const textContent = await page.getTextContent();
//                     const pageText = textContent.items.map((item) => item.str).join(" \n");
//                     const chunks = OrbitaController.splitText(pageText);

//                     for (const [index, chunk] of chunks.entries()) {
//                         const embedding = await OrbitaController.generateEmbedding(chunk);
//                         embeddings.push(embedding);

//                         documents.push({
//                             content: chunk,
//                             metadata: { filename: pdf.filename, page: i, chunkIndex: index },
//                         });
//                     }
//                 }
//             }

//             console.log("Documentos processados:", documents.length);
//             console.log("Embeddings gerados:", embeddings.length);

//             return { embeddings, documents };
//         } catch (error) {
//             console.error("Erro ao processar PDFs:", error);
//             throw error;
//         } finally {
//             await closeConnection();
//         }
//     }

//     // Busca documentos similares
//     static async findSimilarDocuments(queryEmbedding, embeddings, documents) {
//         const similarities = embeddings.map((embedding, index) => ({
//             document: documents[index],
//             score: OrbitaController.cosineSimilarity(queryEmbedding, embedding),
//         }));

//         console.log("Similar documents', " + similarities.sort((a, b) => b.score - a.score).slice(0, 50))

//         return similarities.sort((a, b) => b.score - a.score).slice(0, 10);
//     }

//     // Calcula similaridade de cosseno
//     static cosineSimilarity(a, b) {
//         const dotProduct = a.reduce((sum, val, idx) => sum + val * b[idx], 0);
//         const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val ** 2, 0));
//         const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val ** 2, 0));

//         console.log("Cosine similarity', " + magnitudeA)
//         console.log("Magnitude B', " + magnitudeB)
//         console.log("Dot product', " + dotProduct)

//         return dotProduct / (magnitudeA * magnitudeB);
//     }

//     // Processa a consulta do usuário
//     static async talk_ia(req, res) {
//         const { text } = req.body;

//         try {
//             const { embeddings, documents } = await OrbitaController.processPDFs();
//             const queryEmbedding = await OrbitaController.generateEmbedding(text);
//             const similarDocs = await OrbitaController.findSimilarDocuments(queryEmbedding, embeddings, documents);

//             const prompt = `
//             ### Pergunta do usuário:
//             ${text}
            
//             ### Dados relevantes:
//             ${similarDocs.map((doc) => doc.document.content).join("\n\n")}
            
//             ### Instruções:
//             Você é uma assistente que responde exclusivamente em Português do Brasil. 
//             - Responda à pergunta com base apenas nas informações fornecidas em "Dados relevantes".
//             - Não mencione a origem das informações (documentos ou arquivos).
//             - Use uma linguagem clara, direta e objetiva. Evite formalidades excessivas.
//             - Responda sempre em Português do Brasil, sem exceções.
//             `;
            

//             const completion = await OrbitaController.openaiClient.chat.completions.create({
//                 model: 'llama2:13b',
//                 messages: [
//                     { role: "system", content: `Você é uma assistente que responde exclusivamente em Português do Brasil. Siga o prompt a seguir: ${prompt}` },
//                     { role: "user", content: text }
//                 ],
//             });

//             return res.status(200).json(completion.choices[0].message.content);
//         } catch (error) {
//             console.error("Erro ao processar a solicitação:", error);
//             return res.status(500).send("Erro ao processar a solicitação.");
//         }
//     }
    
// }


//////////////////////////////// Codigo v3 para PDF IA

import OpenAI from 'openai';
import { getDb } from "./src/services/db.js";

export default class OrbitaController {
    // Instância estática reutilizável do cliente OpenAI
    static openaiClient = new OpenAI({
        baseURL: 'http://localhost:11434/v1', // Base URL do Ollama
        apiKey: 'ollama', // Não é usada diretamente
    });

    // Carrega embeddings e metadados diretamente do banco de dados
    static async loadEmbeddings() {
        try {
            const db = await getDb("apiIA_db");
            const embeddingsCollection = db.collection("embeddings");

            // Busca todos os embeddings
            const embeddingsData = await embeddingsCollection.find({}).toArray();
            if (!embeddingsData || embeddingsData.length === 0) {
                throw new Error("Nenhum embedding encontrado no banco de dados.");
            }

            const embeddings = embeddingsData.map(data => data.embedding);
            const documents = embeddingsData.map(data => ({
                content: data.content,
                metadata: {
                    filename: data.filename,
                    page: data.page,
                    chunkIndex: data.chunk_index
                }
            }));

            return { embeddings, documents };
        } catch (error) {
            console.error("Erro ao carregar embeddings:", error);
            throw error;
        }
    }

    // Busca documentos similares com base nos embeddings
    static async findSimilarDocuments(queryEmbedding, embeddings, documents) {
        const similarities = embeddings.map((embedding, index) => ({
            document: documents[index],
            score: OrbitaController.cosineSimilarity(queryEmbedding, embedding),
        }));

        return similarities.sort((a, b) => b.score - a.score).slice(0, 10);
    }

    // Calcula a similaridade de cosseno
    static cosineSimilarity(a, b) {
        const dotProduct = a.reduce((sum, val, idx) => sum + val * b[idx], 0);
        const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val ** 2, 0));
        const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val ** 2, 0));
        return dotProduct / (magnitudeA * magnitudeB);
    }

    // Processa a consulta do usuário
    static async talk_ia(req, res) {
        const { text } = req.body;

        try {
            // Carrega embeddings e documentos do banco
            const { embeddings, documents } = await OrbitaController.loadEmbeddings();

            // Gera o embedding da pergunta do usuário
            const queryEmbedding = await OrbitaController.generateEmbedding(text);

            // Busca documentos similares
            const similarDocs = await OrbitaController.findSimilarDocuments(queryEmbedding, embeddings, documents);

            // Monta o prompt para o modelo
            const prompt = `
            ### Pergunta do usuário:
            ${text}
            
            ### Dados relevantes:
            ${similarDocs.map((doc) => doc.document.content).join("\n\n")}
            
            ### Instruções:
            Você é uma assistente que responde exclusivamente em Português do Brasil. 
            - Responda de forma amigável, empática e natural, como se fosse uma conversa.
            - Responda à pergunta com base apenas nas informações fornecidas em "Dados relevantes".
            - Não mencione a origem das informações (documentos ou arquivos).
            - Use uma linguagem clara, direta e objetiva. Evite formalidades excessivas.
            - Responda sempre em Português do Brasil, sem exceções.
            - Encerre a resposta convidando o usuário a perguntar mais, como "Posso ajudar com mais alguma coisa?".

            `;

            // Envia o prompt para o modelo
            const completion = await OrbitaController.openaiClient.chat.completions.create({
                model: 'llama2:13b',
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: text }
                ],
            });
            const resposta = completion.choices[0].message.content
                .replace(/\n/g, '')
                .replace(/  /g, ' ')
                .replace(/ ,/g, ',')
                .replace(/\. /g, '.')
                .replace(/ \./g, '.')
                .replace(/  /g, ' ')
                .replace(/\.\. /g, '. ')
                .trim();

            return res.status(200).json(resposta);
        } catch (error) {
            console.error("Erro ao processar a solicitação:", error);
            return res.status(500).send("Erro ao processar a solicitação.");
        }
    }

    // Gera o embedding de uma string usando o Ollama
    static async generateEmbedding(text) {
        try {
            const response = await OrbitaController.openaiClient.embeddings.create({
                model: "llama2:13b",
                input: text,
            });

            return response.data[0].embedding;
        } catch (error) {
            console.error("Erro ao gerar embedding:", error);
            throw error;
        }
    }
}


