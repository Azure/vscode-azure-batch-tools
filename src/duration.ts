export function toISO8601(duration: string | undefined) : string | undefined {
    if (!duration) {
        return undefined;
    }

    // Python CLI format is [ddd days, ] hh:mm:dd.ffffff
    const parts = splitDaysPart(duration);

    const days = parts.dayCount;

    const timePart = parts.timePart;
    const timeParts = timePart.split(':').reverse();

    const seconds = Number.parseFloat(timeParts[0]);
    const minutes = timeParts.length > 1 ? Number.parseInt(timeParts[1]) : 0;
    const hours = timeParts.length > 2 ? Number.parseInt(timeParts[2]) : 0;

    // Handle the 'default surfaced as MaxValue' case
    if (days > 10000000) {
        return undefined;
    }

    // Handle the zero duration case
    if (days === 0 && hours === 0 && minutes === 0 && seconds === 0) {
        return 'PT0S';
    }

    // Generate the ISO8601 representation
    var iso = 'P';
    if (days > 0) {
        iso += days + 'D';
    }
    iso += 'T';
    if (hours > 0) {
        iso += hours + 'H';
    }
    if (minutes > 0) {
        iso += minutes + 'M';
    }
    if (seconds > 0) {
        iso += seconds + 'S';
    }

    return iso;
}

function splitDaysPart(duration : string) : { dayCount: number, timePart: string } {
    const daySeps = [ 'days, ', 'day, ' ];

    for (const daySep of daySeps) {
        const daySepIndex = duration.indexOf(daySep);
        if (daySepIndex >= 0) {
            return {
                dayCount: Number.parseInt(duration.substr(0, daySepIndex)),
                timePart: duration.substr(daySepIndex + daySep.length)
            };
        }
    }

    return { dayCount: 0, timePart: duration };
}