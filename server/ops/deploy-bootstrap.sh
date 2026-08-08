#!/bin/bash
set -euo pipefail

CONF_FILE="${DEPLOY_CONF:-$HOME/.deploy.conf}"
PROJECTS_DIR="${PROJECTS_DIR:-$HOME/projects}"

usage() {
  echo "用法: deploy.sh <项目名|all>" >&2
}

if [ -z "${1:-}" ]; then
  usage
  exit 1
fi

deploy_project() {
  local name=$1
  local type=$2
  local port=$3
  local start_cmd=$4
  local repo=$5
  local branch=$6
  local project_dir="$PROJECTS_DIR/$name"

  echo "========== 部署 $name =========="

  if [ -d "$project_dir" ]; then
    echo "[1/4] 拉取最新代码..."
    cd "$project_dir"
    git pull --ff-only origin "$branch"
  else
    echo "[1/4] 首次克隆..."
    git clone -b "$branch" "$repo" "$project_dir"
    cd "$project_dir"
  fi

  if [ -x "$project_dir/server/ops/deploy.sh" ]; then
    echo "[2/4] 使用仓库内部署脚本..."
    bash "$project_dir/server/ops/deploy.sh" "$name" "$type" "$port" "$start_cmd" "$repo" "$branch"
    echo "========== $name 部署完成 =========="
    return
  fi

  echo "[2/4] 安装依赖..."
  case "$type" in
    *node*)
      if [ -d "$project_dir/web" ]; then
        (cd "$project_dir/web" && npm ci)
      else
        (cd "$project_dir" && npm install)
      fi
      ;;
  esac
  case "$type" in
    *python*)
      if [ -f "$project_dir/requirements.txt" ]; then
        (cd "$project_dir" && pip3 install -r requirements.txt 2>/dev/null || true)
      fi
      ;;
  esac

  echo "[3/4] 构建..."
  cd "$project_dir"
  if [ -f "$project_dir/scripts/build.sh" ]; then
    bash "$project_dir/scripts/build.sh"
  else
    timeout 20s bash -lc "$start_cmd" >/dev/null 2>&1 || true
  fi

  echo "[4/4] 部署完成，请手动启动或通过 PM2 管理"
  echo "========== $name 部署完成 =========="
}

if [ "$1" = "all" ]; then
  while IFS='|' read -r name type port start_cmd repo branch; do
    [ -z "$name" ] && continue
    deploy_project "$name" "$type" "$port" "$start_cmd" "$repo" "$branch"
    echo ""
  done < "$CONF_FILE"
else
  line=$(grep "^$1|" "$CONF_FILE" || true)
  if [ -z "$line" ]; then
    echo "错误：未找到项目 '$1'" >&2
    exit 1
  fi
  IFS='|' read -r name type port start_cmd repo branch <<< "$line"
  deploy_project "$name" "$type" "$port" "$start_cmd" "$repo" "$branch"
fi
