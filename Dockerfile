# 웰카오디오 매출/지출관리 시스템 - 컨테이너 이미지 (클라우드 서버·NAS용)
#   docker build -t wellcar .
#   docker run -d -p 8000:8000 -v wellcar-data:/data --name wellcar wellcar
# 데이터(DB·백업·세션 키)는 모두 /data 볼륨에 저장되므로 컨테이너를 새로 만들어도 유지됩니다.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WELLCAR_DB=/data/wellcar.db \
    PORT=8000

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py backup.py exporter.py manage.py seed_demo.py ./
COPY static ./static

VOLUME ["/data"]
EXPOSE 8000
CMD ["python", "app.py"]
