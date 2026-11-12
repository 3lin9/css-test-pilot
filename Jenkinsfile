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
    stage('Typecheck') {
      steps {
        sh 'pnpm typecheck'
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
    // 全链路 e2e 需要 Playwright 浏览器,按 agent 能力开启:
    // stage('E2E') {
    //   steps {
    //     sh 'pnpm exec playwright install --with-deps chromium && pnpm e2e'
    //   }
    // }
    // 业务项目接入 csspilot 后,在业务仓库的 Jenkinsfile 里发布 JUnit 结果:
    // stage('TestPilot') {
    //   steps {
    //     sh 'npx -y csspilot@latest run && npx -y csspilot@latest report --junit'
    //     junit testResults: '.testpilot/runs/*/junit.xml', allowEmptyResults: true
    //   }
    // }
  }
}
