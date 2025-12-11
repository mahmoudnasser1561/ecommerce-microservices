FROM python:3.8-slim

WORKDIR /app

COPY requirements.txt .

RUN pip install -r requirements.txt

COPY inventory_api.py .

EXPOSE 3002

CMD [ "python", "inventory_api.py" ]