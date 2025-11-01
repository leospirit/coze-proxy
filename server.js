import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const COZE_API_HOST = 'https://api.coze.cn'; // 你是 coze.cn 就保持这行
const COZE_BOT_ID   = process.env.COZE_BOT_ID;
const COZE_TOKEN    = process.env.COZE_TOKEN;

console.log('[BOOT] COZE_API_HOST =', COZE_API_HOST);
console.log('[BOOT] COZE_BOT_ID =', COZE_BOT_ID);
console.log('[BOOT] COZE_TOKEN first10 =', COZE_TOKEN ? COZE_TOKEN.slice(0, 10) : '(EMPTY)');

const app = express();
app.use(cors());
app.use(express.json());

// 轮询 Coze 任务状态，直到拿到最终回答或超时
async function waitForAnswer(taskId) {
  const maxTries = 20;        // 最多问20次
  const delayMs  = 500;       // 每次间隔0.5秒

  for (let i = 0; i < maxTries; i++) {
    const resp = await fetch(`${COZE_API_HOST}/v3/chat/retrieve`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: taskId, // Coze 把这个ID当成 chat 任务ID
      })
    });

    const data = await resp.json();
    console.log('[POLL]', i, JSON.stringify(data).slice(0, 400));

    // 如果任务报错，直接结束
    if (data.code !== 0) {
      return { answer: '（Coze 返回错误）' };
    }

    // status 变成 completed / success 之类时，messages 里会有 assistant
    if (data.status === 'completed' || data.status === 'succeeded' || data.status === 'success' || data.status === 'done') {
      let answerText = '';

      if (Array.isArray(data.messages)) {
        const botMsg = data.messages.find(m => m.role === 'assistant');
        if (botMsg && botMsg.content) {
          answerText = botMsg.content;
        }
      }

      if (!answerText) {
        answerText = '（没有拿到assistant回复）';
      }

      return { answer: answerText };
    }

    // 如果还在进行中，等一会再问
    await new Promise(r => setTimeout(r, delayMs));
  }

  return { answer: '（等待超时，稍后再试）' };
}

// 健康检查
app.get('/', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// 主聊天接口：小程序会请求这个
app.post('/api/chat', async (req, res) => {
  const { user_id, message } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required (string)' });
  }

  try {
    // 第一步：创建聊天任务
    const createResp = await fetch(`${COZE_API_HOST}/v3/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bot_id: COZE_BOT_ID,
        user_id: user_id || 'wx_user_001',
        additional_messages: [
          {
            role: 'user',
            content: message,
            content_type: 'text'
          }
        ],
        stream: false
      })
    });

    const createData = await createResp.json();
    console.log('[CREATE]', JSON.stringify(createData).slice(0, 400));

    // createData.data.id 这一项是任务标识（也可能叫 task_id / chat_id）
    const taskId =
      createData?.data?.id ||
      createData?.id ||
      createData?.chat_id ||
      createData?.data?.conversation_id; // 兜底几种字段名

    if (!taskId) {
      return res.json({ answer: '（无法获取任务ID）' });
    }

    // 第二步：轮询等结果
    const finalResult = await waitForAnswer(taskId);

    return res.json(finalResult);
  } catch (err) {
    console.error('Coze proxy error:', err);
    return res.status(500).json({ error: 'Coze API failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
