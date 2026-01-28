import { config } from 'dotenv';
import { resolve } from 'path';

// 加载 .env.local 文件
const envPath = resolve(process.cwd(), '.env.local');

try {
  const envConfig = config({ path: envPath });
  if (envConfig.error) {
    console.warn('Warning: .env.local file not found or cannot be read');
  } else {
    console.log('Loaded environment variables from .env.local');
    // 验证 ANTHROPIC_API_KEY 是否已加载
    if (process.env.ANTHROPIC_API_KEY) {
      console.log('ANTHROPIC_API_KEY is set');
    } else {
      console.warn('Warning: ANTHROPIC_API_KEY is not set in .env.local');
    }
  }
} catch (error) {
  console.error('Error loading .env.local:', error);
}
