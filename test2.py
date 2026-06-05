import requests
from dotenv import load_dotenv
import os
load_dotenv()
token = os.getenv("GITHUB_TOKEN")
headers = {"Authorization": f"Bearer {token}"}

response = requests.get(
    "https://models.inference.ai.azure.com/models",
    headers=headers
)

for model in response.json():
    print(model["id"])
