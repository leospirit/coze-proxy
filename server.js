import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const COZE_API_HOST = 'https://api.coze.cn';
const COZE_BOT_ID   = process.env.COZE_BOT_ID;
const COZE_TOKEN    = process.env.COZE_TOKEN;

console.log('[BOOT] COZE_API_HOST =', COZE_API_HOST);
console.log('[BOOT] COZE_BOT_ID =', COZE_BOT_ID);
console.log('[BOOT] COZE_TOKEN first10 =', COZE_TOKEN ? COZE_TOKEN.slice(0, 10) : '(EMPTY)');

const app = express();
app.use(cors());
app.use(express.json());

// 健康检查
app.get('/', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// ----------------------------------------------------
// 轮询指定会话消息，直到拿到机器人回答
// ----------------------------------------------------
async function pollConversation(conversationId) {
  console.log('[POLL START] using conversationId =', conversationId);

  const maxTries = 20;
  const delayMs  = 1000;

  for (let i = 0; i < maxTries; i++) {
    // ❗ conversation_id 放 URL query，不放 body
    const url = `${COZE_API_HOST}/v1/conversation/message/list?conversation_id=${conversationId}`;

    // body 只放排序/分页等可选参数
    const bodyToSend = {
      order: 'desc', // 最新在最前
      limit: 20
    };

    console.log(`[POLL SEND ${i}] url=`, url, 'body=', bodyToSend);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyToSend)
    });

    const data = await resp.json().catch(() => ({}));
    console.log(`[POLL RAW ${i}]`, JSON.stringify(data).slice(0, 800));

    // 如果还没准备好，继续等
    if (data.code !== 0) {
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }

    // data.data 应该是消息数组，order='desc' -> 最新的在前
    if (Array.isArray(data.data)) {
      const botMsg = data.data.find(
        m =>
          m.role === 'assistant' &&
          typeof m.content === 'string' &&
          m.content.trim() !== ''
      );

      if (botMsg) {
        console.log('[POLL GOT ANSWER]', botMsg.content);
        return botMsg.content;
      }
    }

    // 没拿到回答，等 1s 再问
    await new Promise(r => setTimeout(r, delayMs));
  }

  return '（等待超时或未识别到assistant回复）';
}

// ----------------------------------------------------
// /api/chat：发起对话 -> 轮询 -> 返回answer
// ----------------------------------------------------
app.post('/api/chat', async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required (string)' });
  }

  try {
    // 1. 调用 /v3/chat 发起这轮对话
    const createResp = await fetch(`${COZE_API_HOST}/v3/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bot_id: COZE_BOT_ID,
        user_id: 'wx_user_001',
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

    const createData = await createResp.json().catch(() => ({}));
    console.log('[CREATE RAW]', JSON.stringify(createData).slice(0, 1000));

    // /v3/chat 正常返回：
    // data.conversation_id  = 当前会话ID（我们后面用这个去取消息）
    // data.id               = 本轮chat的任务ID
    // status:"in_progress"  = 还在想答案
    const conversationId = createData?.data?.conversation_id;
    const chatId         = createData?.data?.id;
    console.log('[CREATE EXTRACTED]', { conversationId, chatId });

    if (!conversationId) {
      return res.json({
        answer: '（未拿到 conversation_id，无法继续）',
        coze_debug: createData
      });
    }

    // 2. 轮询这条会话的消息列表，直到看到助手回复
    const answer = await pollConversation(conversationId);

    return res.json({ answer });
  } catch (err) {
    console.error('Coze proxy error:', err);
    return res.status(500).json({ error: 'Coze API failed' });
  }
});

// 启动服务
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
