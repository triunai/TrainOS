# Agentic TPMS Level 2 extraction service.
#
#   docker build -t tpms-ocr services/paddleocr                      # base engine
#   docker build -t tpms-ocr --build-arg WITH_PADDLE=1 services/paddleocr
#   docker run --rm -p 8866:8866 tpms-ocr
FROM python:3.11-slim

ARG WITH_PADDLE=0
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv

COPY requirements.txt requirements-paddle.txt ./
RUN pip install -r requirements.txt \
 && if [ "$WITH_PADDLE" = "1" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
      && rm -rf /var/lib/apt/lists/* \
      && pip install -r requirements-paddle.txt \
      && CV_VERSION="$(pip show opencv-contrib-python | awk '/^Version:/{print $2}')" \
      && pip uninstall -y opencv-python-headless opencv-contrib-python \
      && pip install "opencv-contrib-python==${CV_VERSION}" ; \
    fi

COPY app ./app

RUN useradd --system --uid 10001 --home /srv ocr && chown -R ocr /srv
USER ocr

EXPOSE 8866
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8866/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8866", "--workers", "2"]
