// import { MongoClient, GridFSBucket } from 'mongodb';
// import db from "../services/db.js"

// import axios from "axios";
// import path from "path";
// import fs from 'fs';

// import dotenv from 'dotenv';
// dotenv.config();

// import convertPDF from "../core/convert-pdf.js"

// export default class OrbitaController {

//     static async recovePDF() {    
//         try {
    
//             // Selecionar o banco de dados
//             const db = client.db("apiIA_db");
    
//             // Criar um GridFSBucket para gerenciar os arquivos
//             const bucket = new GridFSBucket(db, { bucketName: 'docs' });
    
//             // Nome do arquivo que deseja baixar
//             const filename = "Daniel Bloch - TCC v3.pdf";
    
//             // Caminho para salvar o PDF baixado
//             const outputPath = path.join(process.cwd(), filename);
    
//             // Buscar o arquivo e gravar em disco
//             const downloadStream = bucket.openDownloadStreamByName(filename);
//             const writeStream = fs.createWriteStream(outputPath);
    
//             return new Promise((resolve, reject) => {
//                 downloadStream.pipe(writeStream);
    
//                 writeStream.on('finish', () => {
//                     console.log(`PDF baixado com sucesso para: ${outputPath}`);
//                     resolve(outputPath);
//                 });
    
//                 writeStream.on('error', (err) => {
//                     console.error("Erro ao salvar o arquivo:", err);
//                     reject(err);
//                 });
//             });
//         } catch (error) {
//             console.error("Erro ao conectar ou recuperar o arquivo:", error);
//             throw error;
//         } finally {
//             await client.close();
//         }
//     }
    

//     static async talk_ia(req, res) {
//         const { text } = req.body;
    
//         try {
//             const pdfText = await OrbitaController.recovePDF();

//             console.log(pdfText)

    
//             // // Limita o tamanho do texto extraído (se necessário)
//             // const context = pdfText.slice(0, 1000);
    
//             // // Cria o prompt para a IA
//             // const prompt = `A partir do PDF: ${context}... Responda a seguinte pergunta: ${text}`;
    
//             // // Envia o prompt para a IA
//             // const response = await axios.post("http://localhost:11434/api/generate", {
//             //     model: "llama3",
//             //     prompt: prompt,
//             //     stream: false,
//             // });
    
//             // // Responde ao cliente com o resultado da IA
//             // const respData = response.data.response.toString();
//             // res.send(respData);
//         } catch (error) {
//             console.error("Erro ao processar a solicitação:", error);
//             res.status(500).send("Erro ao processar a solicitação.");
//         }
//     }
    
// }

import { GridFSBucket } from "mongodb";
import { getDb, closeConnection } from "../services/db.js";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import axios from "axios";
import * as pdfjsLib from "pdfjs-dist";

const vectorStore = new MemoryVectorStore(); // Inicialização sem embedQuery

export default class OrbitaController {
    // Recupera PDFs do MongoDB
    static async recovePDF() {
        try {
            const db = await getDb("apiIA_db");
            const bucket = new GridFSBucket(db, { bucketName: "docs" });
            const files = await db.collection("docs.files").find({}).toArray();

            if (!files || files.length === 0) {
                console.log("Nenhum arquivo PDF encontrado na coleção.");
                return [];
            }

            const pdfBuffers = [];
            for (const file of files) {
                const chunks = [];
                const downloadStream = bucket.openDownloadStream(file._id);

                const pdfBuffer = await new Promise((resolve, reject) => {
                    downloadStream.on("data", (chunk) => chunks.push(chunk));
                    downloadStream.on("end", () => resolve(Buffer.concat(chunks)));
                    downloadStream.on("error", (err) => reject(err));
                });

                pdfBuffers.push({
                    filename: file.filename,
                    buffer: pdfBuffer,
                });

                console.log(`Arquivo '${file.filename}' carregado.`);
            }

            return pdfBuffers;
        } catch (error) {
            console.error("Erro ao recuperar os PDFs:", error);
            throw error;
        }
    }

    // Divide texto em chunks
    static splitText(text, chunkSize = 512) {
        const chunks = [];
        for (let i = 0; i < text.length; i += chunkSize) {
            chunks.push(text.slice(i, i + chunkSize));
        }
        return chunks;
    }

    // Gera embeddings usando a API local do Nomic
    static async generateEmbedding(text) {
        try {
            const response = await axios.post("http://localhost:11434/api/embeddings", {
                model: "nomic-embed-text",
                prompt: text,
            });
            return response.data.embedding;
        } catch (error) {
            console.error("Erro ao gerar embeddings:", error);
            throw error;
        }
    }

    // Adiciona embeddings ao MemoryVectorStore
    static async addToVectorStore(embeddings, documents) {
        try {
            if (!Array.isArray(embeddings) || !Array.isArray(documents)) {
                throw new Error("Embeddings ou documentos inválidos.");
            }
            
            if (embeddings.length !== documents.length) {
                console.error("Tamanhos incompatíveis:", {
                    embeddingsLength: embeddings.length,
                    documentsLength: documents.length
                });
                return;
            }
            
            await vectorStore.addVectors(embeddings, documents);

        } catch (error) {
            console.error("Erro ao adicionar ao VectorStore:", error);
            throw error; // Relança o erro para o chamador lidar
        }
    }
    
    static async findSimilarDocuments(queryEmbedding) {
        try {
            // Realiza a busca por similaridade com base no embedding da consulta
            const similarDocuments = await vectorStore.similaritySearchVectorWithScore(queryEmbedding, 10);

            if (!similarDocuments || similarDocuments.length === 0) {
                console.log("Nenhum documento similar encontrado.");
                return [];
            }

            // Retorna documentos com as pontuações de similaridade
            console.log("Documentos similares encontrados:", similarDocuments);
            return similarDocuments.map(([document, score]) => ({
                document,
                score,
            }));
        } catch (error) {
            console.error("Erro ao buscar documentos similares:", error);
            throw error;
        }
    }


    static async retriveInfo() {
        const embeddings = []; // Para armazenar os vetores
        const documents = [];  // Para armazenar os metadados associados
    
        try {
            // Recupera os PDFs do banco de dados
            const pdfBuffers = await OrbitaController.recovePDF();
    
            // Processa cada PDF, gerando embeddings para cada página e chunk
            for (const pdf of pdfBuffers) {
                console.log(`Processando: ${pdf.filename}`);
    
                const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdf.buffer) });
                const pdfDocument = await loadingTask.promise;
    
                for (let i = 1; i <= pdfDocument.numPages; i++) {
                    const page = await pdfDocument.getPage(i);
                    const textContent = await page.getTextContent();
                    console.log("Itens extraídos da página:", textContent.items);

    
                    const pageText = textContent.items.map((item) => item.str).join(" \n");


                    console.log("Texto completo extraído da página:", pageText);
                    const chunks = OrbitaController.splitText(pageText);
    
                    // Gera embeddings para cada chunk e armazena
                    for (const [index, chunk] of chunks.entries()) {
                        try {
                            const embedding = await OrbitaController.generateEmbedding(chunk);
                            embeddings.push(embedding);
    
                            // Cria documento associado ao embedding
                            const doc = {
                                pageContent: chunk, // Alterado para "pageContent"
                                metadata: {
                                    filename: pdf.filename,
                                    page: i,
                                    chunkIndex: index,
                                },
                                id: i
                            };
                            documents.push(doc);
                            
                            
    
                            console.log("Documento sendo processado:", doc);
                        } catch (error) {
                            console.error(`Erro ao gerar embedding para chunk ${index} da página ${i}:`, error);
                        }
                    }
                }
            }
    
            // Verifica se o número de embeddings e documentos coincide
            if (embeddings.length !== documents.length) {
                throw new Error("Erro: Número de embeddings não coincide com o número de documentos.");
            }
    
            // Adiciona os embeddings e documentos ao VectorStore
            await vectorStore.addVectors(embeddings, documents);
            console.log("Documentos e embeddings adicionados ao VectorStore.");
        } catch (error) {
            console.error("Erro ao processar a solicitação:", error);
            throw error;
        } finally {
            await closeConnection();
        }
    }
    
    

    // Processa a consulta do usuário
    static async talk_ia(req, res) {
        const { text } = req.body; // A consulta ou pergunta do usuário
    
        try {

            const test = await OrbitaController.retriveInfo()
            console.log(test)
            // Gera o embedding da pergunta enviada
            const queryEmbedding = await OrbitaController.generateEmbedding(text);
    
            // Busca documentos similares com base no embedding
            const similarDocs = await OrbitaController.findSimilarDocuments(queryEmbedding);
    
            // Verifica se foram encontrados documentos similares
            if (similarDocs.length === 0) {
                return res.status(404).send("Nenhum documento semelhante encontrado.");
            }
    
            // // Monta uma resposta baseada nos documentos encontrados
            // const response = {
            //     message: "Documentos similares encontrados.",
            //     similarDocuments: similarDocs,
            // };

            const prompt = `
                Você é um assistente virtual que deve buscar todas as referencias do trabalho para dar a melhor resposta possivel de acordo com os dados recebidos. 
                Aqui estão as principais similaridades baseadas no conteudo do texto com a pergunta feita pelo aluno ou professor: 
                ${similarDocs.map(doc => doc.document.pageContent).join("\n")}
                Agora, por favor, responda a seguinte pergunta: ${text}
            `;

            const response = await axios.post("http://localhost:11434/api/generate", {
                model: "llama3",
                prompt: prompt,
                stream: false,
            });
    
            // Envia os documentos similares como resposta
            return res.status(200).json(response.data.response.toString());
        } catch (error) {
            console.error("Erro ao processar a solicitação:", error);
            return res.status(500).send("Erro ao processar a solicitação.");
        }
    }
    
}




//         try {
//             const pdfText = await OrbitaController.recovePDF();

//             console.log(pdfText)

    
//             // // Limita o tamanho do texto extraído (se necessário)
//             // const context = pdfText.slice(0, 1000);
    
//             // // Cria o prompt para a IA
//             // const prompt = `A partir do PDF: ${context}... Responda a seguinte pergunta: ${text}`;
    
//             // // Envia o prompt para a IA
//             // const response = await axios.post("http://localhost:11434/api/generate", {
//             //     model: "llama3",
//             //     prompt: prompt,
//             //     stream: false,
//             // });
    
//             // // Responde ao cliente com o resultado da IA
//             // const respData = response.data.response.toString();
//             // res.send(respData);
//         } catch (error) {
//             console.error("Erro ao processar a solicitação:", error);
//             res.status(500).send("Erro ao processar a solicitação.");
//         }
//     }
