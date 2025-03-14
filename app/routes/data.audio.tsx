import { getDB } from '../lib/mongo';
import { LoaderFunctionArgs } from '@remix-run/node';
import { ObjectId } from 'mongodb';
import _ from 'lodash';
import { authenticateOr401 } from '~/lib/auth.server';


export async function loader({ request }: LoaderFunctionArgs) {
    const auth = await authenticateOr401(request);
    

    const url = new URL(request.url);
    const startParam = url.searchParams.get('start');
    const lastIdParam = url.searchParams.get('lastId');

    if (!startParam) {
        console.log('No start parameter');
        return { segments: [] };
    }


    let startDate = new Date(startParam);
    const limit = 10;
    if (isNaN(startDate.getTime())) {
        throw new Response('Invalid start parameter', { status: 400 });
    }

    if (isNaN(limit) || limit <= 0) {
        throw new Response('Invalid limit parameter', { status: 400 });
    }

    const db = await getDB(auth);
    const collection = db.collection('audio_chunks');

    const load = async (filter: any) => collection
        .find(filter, { sort: { start: 1 }, limit })
        
    

    let segments: any[] = [];

    let filter: any = { start: { $gte: startDate } };

    if (lastIdParam) {
        const prevSegment = await collection.findOne({ _id: new ObjectId(lastIdParam) });
        if (!prevSegment) {
            throw new Response('Invalid lastId parameter', { status: 400 });
        }

        
        segments = await load({ start: { $gt: prevSegment.start }, original_id: prevSegment.original_id })
        const lastIdIndex = segments.findIndex(segment => segment._id.toString() === lastIdParam);
        if (lastIdIndex != -1) {
            segments = segments.slice(lastIdIndex + 1);
        }

        if (segments.length < 1) {
            segments = await load({ start: { $gt: prevSegment.start } });
        }

    } else {
        segments = await load(filter)
    }


    segments = segments
        .slice(0, 1)
        .map((segment: any) => ({
            start: segment.start,
            data: segment.data.buffer.toString('base64'),
            originalID: segment.original_id.toString(),
            _id: segment._id.toString(),
        }));

    console.log('Segments', segments.map((segment) => segment.start));

    return ({ segments });
}