"""Standard question set shared by all auto-generated weekly surveys.

This is the Mindfulness Adherence Questionnaire (MAQ, q1–q12) plus the
Reflective Journal entry (q13).  Every module's weekly survey is seeded
with this list; admins can then customise individual surveys via the
Django admin if a particular week needs different questions.
"""

STANDARD_WEEKLY_QUESTIONS = [
    {
        "id": "q1",
        "type": "integer",
        "text": "How many times did you do formal meditation practice in the past week?",
        "unit": "times",
        "section": "Questions 1 to 6 ask about your formal meditation practice (e.g. sitting meditation).",
    },
    {
        "id": "q2",
        "type": "integer",
        "text": "What was the average duration of each meditation session?",
        "unit": "minutes",
        "skip_if": {"question_id": "q1", "value": 0},
    },
    {
        "id": "q3",
        "type": "likert",
        "text": "When meditating, how much of the time was your attention focused on what you intended to focus on (body, breath, sounds etc.)?",  # noqa: E501
        "min": 0,
        "max": 6,
        "scale_labels": {"0": "Never", "6": "Always"},
        "skip_if": {"question_id": "q1", "value": 0},
    },
    {
        "id": "q4",
        "type": "likert",
        "text": "When meditating, how much of the time were you noticing when you were getting distracted?",
        "min": 0,
        "max": 6,
        "scale_labels": {"0": "Never", "6": "Always"},
        "skip_if": {"question_id": "q1", "value": 0},
    },
    {
        "id": "q5",
        "type": "likert",
        "text": "When meditating, how much of the time were you practicing an accepting attitude toward what you were experiencing?",  # noqa: E501
        "min": 0,
        "max": 6,
        "scale_labels": {"0": "Never", "6": "Always"},
        "skip_if": {"question_id": "q1", "value": 0},
    },
    {
        "id": "q6",
        "type": "likert",
        "text": "When meditating, how much of the time were you practicing being gentle and compassionate toward yourself?",  # noqa: E501
        "min": 0,
        "max": 6,
        "scale_labels": {"0": "Never", "6": "Always"},
        "skip_if": {"question_id": "q1", "value": 0},
    },
    {
        "id": "q7",
        "type": "likert",
        "text": "In your daily life, how much of the time were you practicing paying attention to everyday activities (e.g. eating, walking, chores, communicating etc.)?",  # noqa: E501
        "min": 0,
        "max": 6,
        "scale_labels": {"0": "Never", "6": "Always"},
        "section": "Questions 7 to 12 ask about your informal practice (being mindful in everyday life, outside of meditation sessions).",  # noqa: E501
    },
    {
        "id": "q8",
        "type": "likert",
        "text": "In your daily life, how much of the time were you practicing paying attention while working or studying?",  # noqa: E501
        "min": 0,
        "max": 6,
        "scale_labels": {"0": "Never", "6": "Always"},
    },
    {
        "id": "q9",
        "type": "likert",
        "text": "In your daily life, how much of the time were you practicing bringing your attention back to what you were doing when it wandered off?",  # noqa: E501
        "min": 0,
        "max": 6,
        "scale_labels": {"0": "Never", "6": "Always"},
    },
    {
        "id": "q10",
        "type": "likert",
        "text": "In your daily life, how much of the time were you practicing being aware of your thoughts, emotions and reactions?",  # noqa: E501
        "min": 0,
        "max": 6,
        "scale_labels": {"0": "Never", "6": "Always"},
    },
    {
        "id": "q11",
        "type": "likert",
        "text": "In your daily life, how much of the time were you practicing bringing an accepting attitude toward what you were experiencing?",  # noqa: E501
        "min": 0,
        "max": 6,
        "scale_labels": {"0": "Never", "6": "Always"},
    },
    {
        "id": "q12",
        "type": "likert",
        "text": "In your daily life, how much of the time were you practicing being gentle and compassionate toward yourself?",  # noqa: E501
        "min": 0,
        "max": 6,
        "scale_labels": {"0": "Never", "6": "Always"},
    },
    {
        "id": "q13",
        "type": "longtext",
        "text": "How are you feeling this week? What has been your experience with the mindfulness practice this week?",
    },
]
