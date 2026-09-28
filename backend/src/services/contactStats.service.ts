import { Types } from 'mongoose';
import { Contact } from '../models/Contact';

export interface ContactStatsRange {
  from: Date;
  to: Date;
}

export async function getContactStats(workspaceId: string, range: ContactStatsRange) {
  const workspaceObjectId = new Types.ObjectId(workspaceId);
  const match = {
    workspaceId: workspaceObjectId,
    createdAt: { $gte: range.from, $lte: range.to },
  };

  const [
    totalNew,
    dailySeries,
    sourceLeaderboard,
    cityLeaderboard,
    lifecycleBreakdown,
    temperatureBreakdownRaw,
    heatmapRaw,
  ] = await Promise.all([
    Contact.countDocuments(match),
    Contact.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Contact.aggregate([
      { $match: match },
      { $group: { _id: '$source', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Contact.aggregate([
      { $match: { ...match, city: { $ne: null } } },
      { $group: { _id: '$city', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Contact.aggregate([
      { $match: match },
      { $group: { _id: '$lifecycleStage', count: { $sum: 1 } } },
    ]),
    Contact.aggregate([
      { $match: match },
      { $group: { _id: '$temperature', count: { $sum: 1 } } },
    ]),
    Contact.aggregate([
      { $match: match },
      {
        $project: {
          dow: { $dayOfWeek: '$createdAt' },
          hour: { $hour: '$createdAt' },
        },
      },
      { $group: { _id: { dow: '$dow', hour: '$hour' }, count: { $sum: 1 } } },
    ]),
  ]);

  const daysInRange = Math.max(1, Math.ceil((range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000)));
  const dailyAverage = totalNew / daysInRange;
  const peakDay = dailySeries.reduce<{ date: string; count: number } | null>((peak, cur) => {
    if (!peak || cur.count > peak.count) return { date: cur._id, count: cur.count };
    return peak;
  }, null);

  const topSource = sourceLeaderboard[0]?._id ?? null;
  const topCity = cityLeaderboard[0]?._id ?? null;
  const uniqueSources = sourceLeaderboard.length;

  const qualifiedStages = ['SQL', 'Opportunity', 'Customer', 'Evangelist'];
  const customerStages = ['Customer', 'Evangelist'];
  const qualifiedCount = lifecycleBreakdown
    .filter((l) => qualifiedStages.includes(l._id))
    .reduce((sum, l) => sum + l.count, 0);
  const customerCount = lifecycleBreakdown
    .filter((l) => customerStages.includes(l._id))
    .reduce((sum, l) => sum + l.count, 0);
  const formFillCount = sourceLeaderboard.find((s) => s._id === 'Form')?.count ?? totalNew;

  const heatmap = heatmapRaw.map((h) => ({ dayOfWeek: h._id.dow, hour: h._id.hour, count: h.count }));

  return {
    kpis: {
      newContacts: totalNew,
      dailyAverage: Math.round(dailyAverage * 10) / 10,
      peakDay,
      topSource,
      topCity,
      uniqueSources,
    },
    funnel: [
      { step: 'Form fills', count: formFillCount },
      { step: 'Contacts created', count: totalNew },
      { step: 'Qualified', count: qualifiedCount },
      { step: 'Customers', count: customerCount },
    ],
    dailySeries: dailySeries.map((d) => ({ date: d._id, count: d.count })),
    sourceLeaderboard: sourceLeaderboard.map((s) => ({ source: s._id ?? 'Unknown', count: s.count })),
    cityLeaderboard: cityLeaderboard.map((c) => ({ city: c._id, count: c.count })),
    lifecycleBreakdown: lifecycleBreakdown.map((l) => ({ stage: l._id, count: l.count })),
    temperatureBreakdown: temperatureBreakdownRaw.map((t) => ({ temperature: t._id, count: t.count })),
    heatmap,
  };
}
