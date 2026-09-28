import { Router } from 'express';
import { z } from 'zod';
import { VibeSearch } from '../models/VibeSearch';
import { Contact } from '../models/Contact';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { debitWallet, getOrCreateWallet } from '../services/wallet.service';
import { generateProspects, SEARCH_CREDIT_COST } from '../services/vibeProspecting.service';

export const vibeProspectingRouter = Router();

vibeProspectingRouter.use(authenticate);

const searchSchema = z.object({ query: z.string().min(1) });

vibeProspectingRouter.post('/search', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = searchSchema.parse(req.body);
    const { wallet } = await debitWallet(req.auth!.workspaceId, SEARCH_CREDIT_COST, 'vibe_prospecting_search', `Search: "${body.query}"`);

    const results = generateProspects(body.query);
    const search = await VibeSearch.create({
      workspaceId: req.auth!.workspaceId,
      query: body.query,
      results,
      creditsSpent: SEARCH_CREDIT_COST,
    });

    res.status(201).json({ search, walletBalance: wallet.balance });
  } catch (err) {
    next(err);
  }
});

vibeProspectingRouter.post('/searches/:id/results/:resultId/save', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const search = await VibeSearch.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!search) throw new HttpError(404, 'Search not found');
    const result = search.results.find((r) => r.id === req.params.resultId);
    if (!result) throw new HttpError(404, 'Result not found');
    if (result.saved) throw new HttpError(400, 'Already saved to CRM');

    const contact = await Contact.create({
      workspaceId: req.auth!.workspaceId,
      name: result.name,
      jobTitle: result.title,
      company: result.company,
      city: result.city,
      source: 'Vibe Prospecting',
      attributionFirst: { source: 'Vibe Prospecting', date: new Date() },
      attributionLatest: { source: 'Vibe Prospecting', date: new Date() },
    });

    result.saved = true;
    await search.save();

    res.status(201).json({ contact });
  } catch (err) {
    next(err);
  }
});

vibeProspectingRouter.get('/stats', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [searchesToday, totalSearches, searches, wallet] = await Promise.all([
      VibeSearch.countDocuments({ workspaceId: req.auth!.workspaceId, createdAt: { $gte: today } }),
      VibeSearch.countDocuments({ workspaceId: req.auth!.workspaceId }),
      VibeSearch.find({ workspaceId: req.auth!.workspaceId }).lean(),
      getOrCreateWallet(req.auth!.workspaceId),
    ]);

    const leadsSaved = searches.reduce((sum, s) => sum + s.results.filter((r) => r.saved).length, 0);
    const creditsSpent7d = searches
      .filter((s) => s.createdAt.getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000)
      .reduce((sum, s) => sum + s.creditsSpent, 0);
    const totalResults = searches.reduce((sum, s) => sum + s.results.length, 0);

    res.json({
      searchesToday,
      totalSearches,
      leadsSaved,
      convertedToCrm: leadsSaved,
      creditsSpent7d,
      avgResultsPerSearch: totalSearches > 0 ? Math.round((totalResults / totalSearches) * 10) / 10 : 0,
      saveRate: totalResults > 0 ? Math.round((leadsSaved / totalResults) * 1000) / 10 : 0,
      walletBalance: wallet.balance,
    });
  } catch (err) {
    next(err);
  }
});
