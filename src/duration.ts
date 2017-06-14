import * as moment from 'moment';
import * as momentFmt from 'moment-duration-format';

export function toISO8601(duration: string | undefined) : string | undefined {
    if (!duration) {
        return undefined;
    }

    // Python CLI format is [ddd days, ] hh:mm:ss.ffffff -
    // Moment requires ddd.hh:mm:ss.ffffff
    const mfduration = duration.replace(' days, ', '.').replace(' day, ', '.');

    const dur = moment.duration(mfduration);

    // Handle the 'default surfaced as MaxValue' case
    if (dur.asDays() > 10000000) {
        return undefined;
    }

    // Handle the zero case
    if (dur.asSeconds() === 0) {
        return "PT0S";
    }

    return dur.toISOString();
}
