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
app.get('/', (req, res) => res.json({ status: 'ok', time: Date.now() }));

// 轮询：从 /v1/conversation/message/list 取 assistant 回复
async function pollConversation(conversationId) {
  const maxTries = 20;
  const delay = 1000;

  for (let i = 0; i < maxTries; i++) {
    // 打一条日志，确认我们传的会话ID是不是空
    console.log('[POLL] attempt', i, 'with conversationId =', conversationId);

    const bodyToSend = {
      conversation_id: conversationId,
    };

    const resp = await fetch(`${COZE_API_HOST}/v1/conversation/message/list`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyToSend)
    });

    const data = await resp.json().catch(() => ({}));

    // 打后端原始响应，方便我们看到真正结构
    console.log('[POLL_RAW]', i, JSON.stringify(data).slice(0, 500));

    // 如果返回错误（code !== 0），继续等下一轮
    if (typeof data.code !== 'undefined' && data.code !== 0) {
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    // 如果 data.data 是消息数组，则尝试找 assistant 回复
    if (Array.isArray(data.data)) {
      const botMsg = data.data.find(
        m =>
          m.role === 'assistant' &&
          typeof m.content === 'string' &&
          m.content.trim() !== ''
      );
      if (botMsg) {
        return botMsg.content;
      }
    }

    // 没拿到就等下一轮
    await new Promise(r => setTimeout(r, delay));
  }

  return '（等待超时或未识别到assistant回复）';
}

// 主接口：创建会话 + 轮询获取回复
app.post('/api/chat', async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required (string)' });
  }

  try {
    // 第一步：创建会话
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

    // 我们把所有可能的ID字段都打出来
    console.log('[CREATE IDS guess]', {
      'data.conversation_id': createData?.data?.conversation_id,
      'data.id':             createData?.data?.id,
      'data.chat_id':        createData?.data?.chat_id,
      'conversation_id':     createData?.conversation_id,
      'id':                  createData?.id,
      'chat_id':             createData?.chat_id,
    });

    // 尝试用各种可能字段来当 conversationId
    const conversationIdCandidate =
      createData?.data?.conversation_id ||
      createData?.data?.id ||
      createData?.data?.chat_id ||
      createData?.conversation_id ||
      createData?.id ||
      createData?.chat_id;

    console.log('[CHOSEN conversationIdCandidate =]', conversationIdCandidate);

    if (!conversationIdCandidate) {
      return res.json({ answer: '（无法获取会话ID）' });
    }

    // 第二步：轮询获取真正的assistant回复
    const answer = await pollConversation(conversationIdCandidate);

    return res.json({ answer });
  } catch (err) {
    console.error('Coze proxy error:', err);
    return res.status(500).json({ error: 'Coze API failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
