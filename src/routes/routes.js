import axios from "axios";
import { Router } from "express";
import OrbitaController from "../controllers/orbita.controller.js"; // Corrija o caminho conforme necessário
import FaamaControler from "../controllers/faama.controller.js";
import DescribeImageController from "../controllers/describe-image.controller.js";


const router = Router()

router.post("/ia", OrbitaController.talk_ia);
router.post("/ia-describe-image", DescribeImageController.describe_img_ia);
router.post("/faama-ia-suport", FaamaControler.responseAssist);


export default router