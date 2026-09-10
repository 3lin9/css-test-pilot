pipeline {
  agent any

  tools {
    // 需要在 Jenkins 全局工具配置中创建名为 node22 的 Node.js 22 安装
    nodejs 'node22'
  }

  environment {
    CI = 'true'
  }

  stages {
    stage('Install') {
      steps {
        sh 'corepack enable && pnpm install --frozen-lockfile'
      }
    }
    stage('Lint') {
      steps {
        sh 'pnpm lint'
      }
    }
    stage('Build') {
      steps {
        sh 'pnpm build'
      }
    }
    stage('Test') {
      steps {
        sh 'pnpm test'
      }
    }
  }
}
