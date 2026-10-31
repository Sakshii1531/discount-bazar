import React, { useState, useEffect } from 'react';
import MainLocationHeader from '../components/shared/MainLocationHeader';
import CategoryTile, { CATEGORY_TILE_GRID, categoryTileTint } from '../components/shared/CategoryTile';
import { customerApi } from '../services/customerApi';

const CategoriesPage = () => {
    const [groups, setGroups] = useState([]);
    const [, setIsLoading] = useState(true);

    const fetchCategories = async () => {
        setIsLoading(true);
        try {
            const res = await customerApi.getCategories({ tree: true });
            if (res.data.success) {
                const tree = res.data.results || res.data.result || [];
                const formattedGroups = tree
                    .filter((header) => (header.name || '').trim().toLowerCase() !== 'all')
                    .map((header, idx) => {
                        const categories = (header.children || []).map((cat, cIdx) => ({
                            id: cat._id,
                            name: cat.name,
                            image: cat.image,
                            tint: categoryTileTint(idx + cIdx)
                        }));

                        return {
                            title: header.name,
                            categories,
                        };
                    })
                    .filter((group) => group.categories.length > 0);
                setGroups(formattedGroups);
            }
        } catch (error) {
            console.error("Error fetching categories:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchCategories();
    }, []);

    return (
        <div className="min-h-screen bg-white">
            <MainLocationHeader />
            <div className="max-w-[1280px] mx-auto px-4 pt-[140px] md:pt-[150px] pb-20">
                {groups.map((group, groupIdx) => (
                    <div key={groupIdx} className="mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${groupIdx * 100}ms` }}>
                        <h2 className="text-lg md:text-2xl font-black text-[#1A1A1A] mb-3 md:mb-5 px-0.5">
                            {group.title}
                        </h2>

                        <div className={CATEGORY_TILE_GRID}>
                            {group.categories.map((category) => (
                                <CategoryTile
                                    key={category.id}
                                    to={`/category/${category.id}`}
                                    name={category.name}
                                    image={category.image}
                                    tint={category.tint}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default CategoriesPage;
