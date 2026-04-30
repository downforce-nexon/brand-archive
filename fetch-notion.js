const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const fs = require('fs');

const TOKEN = process.env.NOTION_TOKEN;
const DB_ID = 'b2b377adca99480db589d95583a7ba13';
const PROXY = 'https://notion-pat-proxy.nexon.co.kr';

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

// 노션 블록(페이지 본문)을 섹션 배열로 변환
function parseBlocks(blocks) {
  const sections = [];
  let current = null;

  for (const block of blocks) {
    const type = block.type;

    if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
      if (current) sections.push(current);
      const text = block[type].rich_text.map(t => t.plain_text).join('');
      current = { title: text, body: '', images: [] };

    } else if (type === 'paragraph') {
      const text = block[type].rich_text.map(t => t.plain_text).join('');
      if (text && current) current.body += (current.body ? '\n' : '') + text;

    } else if (type === 'video') {
      const url = block.video.type === 'file'
        ? block.video.file.url
        : block.video.external.url;
      if (current) current.images.push({ type: 'video', url });
      else sections.push({ title: '', body: '', images: [{ type: 'video', url }] });

    } else if (type === 'image') {
      const url = block.image.type === 'file'
        ? block.image.file.url
        : block.image.external.url;
      if (current) current.images.push({ type: 'image', url });
      else sections.push({ title: '', body: '', images: [{ type: 'image', url }] });
    }
  }

  if (current) sections.push(current);
  return sections;
}

async function fetchDB() {
  const res = await fetch(`${PROXY}/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      filter: { property: 'Published', checkbox: { equals: true } }
    }),
  });
  const data = await res.json();
  return data.results;
}

async function fetchPageBlocks(pageId) {
  const res = await fetch(`${PROXY}/v1/blocks/${pageId}/children?page_size=100`, { headers });
  const data = await res.json();
  return data.results || [];
}

function getProp(page, key) {
  const prop = page.properties[key];
  if (!prop) return '';
  switch (prop.type) {
    case 'title': return prop.title.map(t => t.plain_text).join('');
    case 'rich_text': return prop.rich_text.map(t => t.plain_text).join('');
    case 'select': return prop.select?.name || '';
    case 'multi_select': return prop.multi_select.map(s => s.name);
    case 'checkbox': return prop.checkbox;
    case 'number': return prop.number;
    case 'files': return prop.files.map(f => f.type === 'file' ? f.file.url : f.external.url);
    default: return '';
  }
}

async function main() {
  console.log('노션 DB 읽는 중...');
  const pages = await fetchDB();
  console.log(`총 ${pages.length}개 프로젝트 발견`);

  const projects = [];

  for (const page of pages) {
    const id = page.id.replace(/-/g, '');
    const title = getProp(page, 'Title');
    console.log(`  처리 중: ${title}`);

    const blocks = await fetchPageBlocks(page.id);
    const sections = parseBlocks(blocks);

    const thumbnail = getProp(page, 'Thumbnail');
    const thumbnailVideo = getProp(page, 'Thumbnail Video');

    projects.push({
      id,
      title,
      category: getProp(page, 'Category'),
      featured: getProp(page, 'Featured'),
      product: getProp(page, 'Product'),
      year: getProp(page, 'Year'),
      credits: getProp(page, 'Credits'),
      tags: getProp(page, 'Tags'),
      color: getProp(page, 'Color') || '#D8D8D8',
      thumbnail: thumbnail[0] || '',
      thumbnailVideo: thumbnailVideo[0] || '',
      sections, // 본문+이미지 섹션 배열
    });
  }

  // filter 배열 자동 생성 (Featured 체크된 것 + 카테고리)
  for (const p of projects) {
    p.filter = [p.category.toLowerCase()];
    if (p.featured) p.filter.push('all');
  }

  fs.writeFileSync('data.json', JSON.stringify({ projects }, null, 2), 'utf-8');
  console.log('✅ data.json 생성 완료!');
}

main().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
