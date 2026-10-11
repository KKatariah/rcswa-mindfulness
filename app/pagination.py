"""Paging for the lists that keep growing over the years: users, enrollments and forum threads."""

from rest_framework.pagination import LimitOffsetPagination


class ListPagination(LimitOffsetPagination):
    """?limit=&offset=; responds with {count, next, previous, results}."""

    default_limit = 25
    max_limit = 100
