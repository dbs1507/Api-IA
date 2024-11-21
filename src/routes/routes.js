import axios from "axios";
import { Router } from "express";
import OrbitaController from "../controllers/orbita.controller.js"; // Corrija o caminho conforme necessário


const router = Router()

router.post("/ia", OrbitaController.talk_ia);


export default router