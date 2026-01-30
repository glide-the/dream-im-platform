import { Pool, PoolClient } from 'pg';

let testPool: Pool | null = null;
let testClient: PoolClient | null = null;

/**
 * 设置测试数据库连接
 * 使用独立的事务，测试后自动回滚
 */
export async function setupTestDatabase() {
  if (testClient) {
    return; // 已经设置过了
  }

  // 使用测试数据库 URL，如果不存在则使用默认的
  const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL or DATABASE_URL must be set for integration tests'
    );
  }

  testPool = new Pool({ connectionString });
  testClient = await testPool.connect();

  // 开始事务
  await testClient.query('BEGIN');

  console.log('[Test Database] Connected with transaction');
}

/**
 * 清理测试数据库
 * 回滚事务，释放连接
 */
export async function teardownTestDatabase() {
  if (testClient) {
    await testClient.query('ROLLBACK');
    testClient.release();
    testClient = null;
  }

  if (testPool) {
    await testPool.end();
    testPool = null;
  }

  console.log('[Test Database] Rolled back and disconnected');
}

/**
 * 获取测试数据库客户端
 */
export async function getTestClient(): Promise<PoolClient> {
  if (!testClient) {
    throw new Error('Test database not initialized. Call setupTestDatabase() first.');
  }
  return testClient;
}

/**
 * 创建测试保存点
 * 每个测试前调用，用于隔离测试数据
 */
export async function createTestSavepoint() {
  const client = await getTestClient();
  await client.query('SAVEPOINT test_savepoint');
}

/**
 * 回滚到测试保存点
 * 每个测试后调用，清理测试数据
 */
export async function rollbackToTestSavepoint() {
  const client = await getTestClient();
  await client.query('ROLLBACK TO SAVEPOINT test_savepoint');
}

/**
 * 执行测试 SQL 查询
 * 用于在测试中直接操作数据库
 */
export async function executeTestQuery<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const client = await getTestClient();
  const result = await client.query(text, params);
  return result.rows as T[];
}

/**
 * 清空指定表的数据（用于特定测试场景）
 */
export async function truncateTable(tableName: string) {
  const client = await getTestClient();
  await client.query(`TRUNCATE TABLE ${tableName} CASCADE`);
}
