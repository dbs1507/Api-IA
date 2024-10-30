# main.py
from fastapi import FastAPI
from app.routes import router  # Certifique-se de que o objeto exportado é "router" no routes.py

app = FastAPI()

# Inclui as rotas no aplicativo
app.include_router(router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
