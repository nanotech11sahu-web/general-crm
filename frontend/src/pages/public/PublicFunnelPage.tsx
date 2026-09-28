import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import type { FunnelBlock } from '../../types/leadgen';

interface PublicPageResponse {
  page: { name: string; blocks: FunnelBlock[] };
  funnelName: string;
}

export function PublicFunnelPage() {
  const { publicId, '*': rest } = useParams<{ publicId: string; '*': string }>();
  const path = rest ? `/${rest}` : '/';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-funnel-page', publicId, path],
    queryFn: async () => {
      const res = await api.get(`/public/funnels/${publicId}/pages${path === '/' ? '/' : path}`);
      return res.data as PublicPageResponse;
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-slate-500">Loading page…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-white text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
        <p className="text-slate-500">This page hasn't been published yet.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-16">
        {data.page.blocks.map((block) => (
          <Block key={block.id} block={block} />
        ))}
      </div>
    </div>
  );
}

function Block({ block }: { block: FunnelBlock }) {
  switch (block.type) {
    case 'heading':
      return <h1 className="text-4xl font-bold text-slate-900">{block.content}</h1>;
    case 'text':
      return <p className="text-lg text-slate-600">{block.content}</p>;
    case 'image':
      return <img src={block.content} alt="" className="w-full rounded-lg" />;
    case 'cta':
      return (
        <a href={block.href ?? '#'} className="inline-block rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700">
          {block.content}
        </a>
      );
    case 'divider':
      return <hr className="border-slate-200" />;
    default:
      return null;
  }
}
