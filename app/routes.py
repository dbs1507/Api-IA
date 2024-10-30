# app/routes.py
from fastapi import APIRouter

router = APIRouter()

@router.get("/example")
async def example_route():
    return {"message": "Hello, World!"}
