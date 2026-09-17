export type AudioAttribution = {
	artistName: string;
	artistUrl: string;
	trackTitle: string;
	trackUrl: string;
};

export type TextBlock = {
	id: string | number;
	type: "text";
	content: string;
};

export type VideoBlock = {
	id: string | number;
	type: "video";
	title?: string;
	embedUrl?: string;
	completed?: boolean;
};

export type AudioBlock = {
	id: string | number;
	type: "audio";
	title?: string;
	embedUrl?: string;
	attribution?: AudioAttribution;
	completed?: boolean;
};

export type ContentBlock = TextBlock | VideoBlock | AudioBlock;
