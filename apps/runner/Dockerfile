FROM ubuntu:24.04@sha256:c4a8d5503dfb2a3eb5f807da5bc69a85730fb49b5cfca2330194ebcc41c7b

ENV DEBIAN_FRONTEND=noninteractive

# 실행 툴체인 — 실무 시뮬레이션이므로 "평범한 개발 워크스테이션"이 되어야 한다.
# 이 컨테이너는 internal 네트워크에만 붙어 외부 인터넷과 데이터베이스에 닿지
# 않으므로(docker-compose.yml 참조), 필요한 것은 전부 미리 깔아 둔다.
RUN apt-get update && apt-get install -y --no-install-recommends \
        bash coreutils findutils grep sed gawk diffutils procps util-linux iproute2 \
        less vim-tiny nano file tree bc unzip zip xz-utils time \
        ca-certificates locales tini \
        git \
        jq sqlite3 ripgrep \
        python3 python3-pip python3-venv python3-dev python-is-python3 \
        python3-numpy python3-pandas python3-yaml python3-requests \
        python3-dateutil python3-tabulate python3-pytest python3-redis \
        nodejs npm \
        gcc g++ make cmake pkg-config \
        openjdk-21-jdk-headless golang-go \
    && rm -rf /var/lib/apt/lists/*

RUN sed -i 's/# C.UTF-8/C.UTF-8/' /etc/locale.gen 2>/dev/null || true

RUN git config --system user.name "Candidate" \
    && git config --system user.email "candidate@odysseus.local" \
    && git config --system init.defaultBranch main \
    && git config --system --add safe.directory '*'

RUN mkdir -p /work && chmod 711 /work

WORKDIR /app
COPY worker.py reliable_worker.py sandbox.py probe.py resources.py ./

ENTRYPOINT ["tini", "--"]
CMD ["python3", "reliable_worker.py"]
