import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.MONGO_URI;
let client;
let clientPromise;

// Função para conectar ao banco
async function connectToDatabase() {
    if (!client) {
        client = new MongoClient(uri, { useUnifiedTopology: true });
        clientPromise = client.connect();
    }
    return clientPromise;
}

// Exporta o cliente e a função de conexão
export async function getDb(dbName) {
    await connectToDatabase();
    return client.db(dbName);
}

export async function closeConnection() {
    if (client) {
        await client.close();
        client = null;
    }
}
