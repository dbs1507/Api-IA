import { Router } from "express";
import AgentController from "../controllers/agent.controller.js";
import WhatsApp from "../controllers/whatsapp.controller.js";

console.log('WhatsApp controller imported:', WhatsApp);

const router = Router()

//Rotas dos agentes de IA
router.post("/create-agent", AgentController.createAgent);
router.get("/get-agents", AgentController.getAgents);

// Rotas do WhatsApp
// router.post("/send-message", WhatsApp.sendMessage);
router.get("/setup-webhook", WhatsApp.setupWebhook);
// router.get("/get-messages", WhatsApp.getMessages);
// router.post("/clear-messages", WhatsApp.clearMessages);
// router.post("/test-agent", WhatsApp.testAgent);

export default router