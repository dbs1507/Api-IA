
import { GridFSBucket } from "mongodb";
import { getDb, closeConnection } from "../services/db.js";
import axios from "axios";
import * as pdfjsLib from "pdfjs-dist";
import OpenAI from 'openai';

export default class DescribeImageController {

    static async recoveImage() {
        try {
            const db = await getDb("apiIA_db");
            const bucket = new GridFSBucket(db, { bucketName: "image" });
            const files = await db.collection("image.files").find({}).toArray();
    
            if (!files || files.length === 0) {
                console.log("Nenhum arquivo encontrado na coleção.");
                return null;
            }
    
            // Recupera o primeiro arquivo da coleção (ajuste conforme necessário)
            const file = files[0];
            const chunks = [];
            const downloadStream = bucket.openDownloadStream(file._id);
    
            const imageBuffer = await new Promise((resolve, reject) => {
                downloadStream.on("data", (chunk) => chunks.push(chunk));
                downloadStream.on("end", () => resolve(Buffer.concat(chunks)));
                downloadStream.on("error", (err) => reject(err));
            });
    
            console.log(`Arquivo '${file.filename}' carregado com sucesso.`);
            return {
                filename: file.filename,
                base64: imageBuffer.toString("base64"), // Converte para base64
            };
        } catch (error) {
            console.error("Erro ao recuperar a imagem:", error);
            throw error;
        }
    }
    
    
    static async describe_img_ia(req, res) {
        const { text } = req.body;
    
        try {
            const imageData = await DescribeImageController.recoveImage();
            console.log(imageData)
    
            if (!imageData) {
                return res.status(404).send("Nenhuma imagem encontrada.");
            }
    
            const prompt = `
                Descreva a imagem como um audiodescritor experiente baseada na pergunta "${text}" feita por um usuário. Foque nos detalhes importantes para transmitir a cena a uma pessoa cega, 
                respondendo: o que está acontecendo, quem são os personagens ou elementos principais, como é o ambiente ao redor e qual é a sensação geral transmitida pela imagem? 
                Seja claro, objetivo e detalhado, priorizando a informação visual mais relevante sem interpretações subjetivas e responda em português do Brasil.
            `;
    
            const response = await axios.post("http://localhost:11434/api/generate", {
                model: "llava",
                prompt: prompt,
                images: [imageData.base64], // Inclua no array, se necessário
            });
    
            return res.status(200).json({
                message: response.data
                  .split('\n') // Divide a resposta em linhas
                  .filter((line) => line.trim() !== '') // Remove linhas vazias
                  .map((line) => JSON.parse(line).response) // Parseia cada linha como JSON e extrai o 'response'
                  .join('') // Junta todas as partes em uma única string
            });

        } catch (error) {
            console.error("Erro ao processar a solicitação:", error);
            return res.status(500).send("Erro ao processar a solicitação.");
        }
    }

}